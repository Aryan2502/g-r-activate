-- Emulation of a fresh hosted Supabase project (Postgres 17), applied by
-- harness.ts BEFORE supabase/migrations/*.sql. Test-only: never copy this into
-- a migration, the real project already has all of it.
--
-- Fidelity notes (details in harness.ts):
-- * PGlite's session user "postgres" is a superuser and cannot be demoted. On
--   Supabase "postgres" is a non-superuser with BYPASSRLS. The event triggers at
--   the bottom reject DDL that Supabase refuses in its managed schemas, which is
--   the main way a superuser-run migration would pass here and fail there.
-- * Only the objects our migrations/tests may touch are emulated; vault is a
--   behavioural stub (no encryption).
-- * pg_cron and pg_net are available on Supabase but NOT installed in a fresh
--   project, so `cron` and `net` do not exist here either. harness.ts loads
--   pg_cron-stub.sql / pg_net-stub.sql when a migration runs
--   `create extension pg_cron` / `pg_net`, exactly where it does.

-- ---------------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------------
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;
create role authenticator login noinherit;
create role supabase_auth_admin login noinherit createrole;
create role supabase_storage_admin login noinherit createrole;

grant anon, authenticated, service_role to authenticator;
grant anon, authenticated, service_role to postgres;

-- ---------------------------------------------------------------------------
-- public: Supabase grants usage plus ALL on future objects to the API roles.
-- This is why every migration must revoke explicitly (SPEC §35.3).
-- ---------------------------------------------------------------------------
grant usage on schema public to anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant all on sequences to anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant all on functions to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- extensions: Supabase pre-installs pgcrypto and uuid-ossp here, and the
-- postgres role's search_path is "$user", public, extensions.
-- ---------------------------------------------------------------------------
create schema extensions;
grant usage on schema extensions to anon, authenticated, service_role;
create extension pgcrypto with schema extensions;
create extension "uuid-ossp" with schema extensions;

-- ---------------------------------------------------------------------------
-- auth (GoTrue). GoTrue connects as supabase_auth_admin with search_path=auth,
-- so triggers on auth.users run as that role, which has no rights in public.
-- ---------------------------------------------------------------------------
create schema auth authorization supabase_auth_admin;
grant usage on schema auth to anon, authenticated, service_role, postgres;

create table auth.users (
  instance_id uuid,
  id uuid not null primary key default gen_random_uuid(),
  aud varchar(255),
  role varchar(255),
  email varchar(255),
  encrypted_password varchar(255),
  email_confirmed_at timestamptz,
  invited_at timestamptz,
  confirmation_token varchar(255),
  confirmation_sent_at timestamptz,
  recovery_token varchar(255),
  recovery_sent_at timestamptz,
  email_change varchar(255),
  email_change_sent_at timestamptz,
  last_sign_in_at timestamptz,
  raw_app_meta_data jsonb not null default '{}'::jsonb,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  is_super_admin boolean,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  phone text unique default null,
  phone_confirmed_at timestamptz,
  confirmed_at timestamptz generated always as (least(email_confirmed_at, phone_confirmed_at)) stored,
  banned_until timestamptz,
  is_sso_user boolean not null default false,
  deleted_at timestamptz,
  is_anonymous boolean not null default false
);
-- GoTrue's real uniqueness rule for email (not a plain unique constraint).
create unique index users_email_partial_key on auth.users (email) where (is_sso_user = false);
alter table auth.users owner to supabase_auth_admin;
grant all on all tables in schema auth to postgres;

-- Same bodies as Supabase: legacy request.jwt.claim.* first, then the claims JSON.
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

create function auth.role() returns text language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;

create function auth.email() returns text language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.email', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email')
  )::text
$$;

create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')
  )::jsonb
$$;

alter function auth.uid() owner to supabase_auth_admin;
alter function auth.role() owner to supabase_auth_admin;
alter function auth.email() owner to supabase_auth_admin;
alter function auth.jwt() owner to supabase_auth_admin;

-- ---------------------------------------------------------------------------
-- storage. The Storage API runs queries as the caller's role, so the API roles
-- hold table privileges and RLS policies (written by migrations) decide access.
-- Bucket limits (size, MIME types) are enforced by the API, not emulated here.
-- ---------------------------------------------------------------------------
create schema storage authorization supabase_storage_admin;
grant usage on schema storage to anon, authenticated, service_role, postgres;

create table storage.buckets (
  id text not null primary key,
  name text not null,
  owner uuid,
  owner_id text,
  public boolean default false,
  avif_autodetection boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[],
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create unique index bname on storage.buckets (name);

create table storage.objects (
  id uuid not null primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text,
  owner uuid,
  owner_id text,
  metadata jsonb,
  user_metadata jsonb,
  path_tokens text[] generated always as (string_to_array(name, '/')) stored,
  version text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  last_accessed_at timestamptz default now()
);
create unique index bucketid_objname on storage.objects (bucket_id, name);

alter table storage.buckets enable row level security;
alter table storage.objects enable row level security;
alter table storage.buckets owner to supabase_storage_admin;
alter table storage.objects owner to supabase_storage_admin;
grant all on storage.buckets, storage.objects to anon, authenticated, service_role, postgres;

create function storage.foldername(name text) returns text[] language plpgsql as $$
declare
  _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[1:array_length(_parts, 1) - 1];
end
$$;

create function storage.filename(name text) returns text language plpgsql as $$
declare
  _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[array_length(_parts, 1)];
end
$$;

create function storage.extension(name text) returns text language plpgsql as $$
declare
  _parts text[];
  _filename text;
begin
  select string_to_array(name, '/') into _parts;
  select _parts[array_length(_parts, 1)] into _filename;
  return reverse(split_part(reverse(_filename), '.', 1));
end
$$;

alter function storage.foldername(text) owner to supabase_storage_admin;
alter function storage.filename(text) owner to supabase_storage_admin;
alter function storage.extension(text) owner to supabase_storage_admin;

-- Supabase refuses plain SQL deletes on both tables, for every role and even
-- when no row matches, unless the session opts in the way the Storage API
-- does (set local storage.allow_delete_query = 'true'). Reset scripts must
-- remove files through the Storage API, or set that flag knowingly.
create function storage.protect_delete() returns trigger language plpgsql as $$
begin
  if coalesce(current_setting('storage.allow_delete_query', true), 'false') <> 'true' then
    raise exception 'Direct deletion from storage tables is not allowed. Use the Storage API instead.'
      using errcode = '42501', hint = 'This prevents accidental data loss from orphaned objects.';
  end if;
  return null;
end
$$;
alter function storage.protect_delete() owner to supabase_storage_admin;

create trigger protect_buckets_delete before delete on storage.buckets
  for each statement execute function storage.protect_delete();
create trigger protect_objects_delete before delete on storage.objects
  for each statement execute function storage.protect_delete();

-- ---------------------------------------------------------------------------
-- vault (stub): secrets are stored in clear text. Only postgres can read them,
-- as on Supabase.
-- ---------------------------------------------------------------------------
create schema vault;
revoke all on schema vault from public;
grant usage on schema vault to postgres;

create table vault.secrets (
  id uuid not null primary key default gen_random_uuid(),
  name text,
  description text not null default '',
  secret text not null,
  key_id uuid,
  nonce bytea,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index secrets_name_idx on vault.secrets (name) where name is not null;

create view vault.decrypted_secrets as
  select id, name, description, secret, secret as decrypted_secret, key_id, nonce, created_at, updated_at
  from vault.secrets;

create function vault.create_secret(
  new_secret text,
  new_name text default null,
  new_description text default '',
  new_key_id uuid default null
) returns uuid language sql security definer set search_path = '' as $$
  insert into vault.secrets (secret, name, description, key_id)
  values (new_secret, new_name, coalesce(new_description, ''), new_key_id)
  returning id
$$;

create function vault.update_secret(
  secret_id uuid,
  new_secret text default null,
  new_name text default null,
  new_description text default null,
  new_key_id uuid default null
) returns void language sql security definer set search_path = '' as $$
  update vault.secrets set
    secret = coalesce(new_secret, secret),
    name = coalesce(new_name, name),
    description = coalesce(new_description, description),
    key_id = coalesce(new_key_id, key_id),
    updated_at = now()
  where id = secret_id
$$;

revoke all on all tables in schema vault from public, anon, authenticated, service_role;
revoke all on all functions in schema vault from public, anon, authenticated, service_role;
grant select, delete on vault.secrets, vault.decrypted_secrets to postgres;
grant execute on all functions in schema vault to postgres;

-- ---------------------------------------------------------------------------
-- Realtime publication and the CLI's migration history table.
-- ---------------------------------------------------------------------------
create publication supabase_realtime;

create schema supabase_migrations;
create table supabase_migrations.schema_migrations (
  version text not null primary key,
  statements text[],
  name text
);

-- ---------------------------------------------------------------------------
-- Guard: hosted Supabase refuses most DDL by "postgres" inside its managed
-- schemas (not owner / supautils). Allowed there and here: triggers on auth
-- tables, policies and triggers on storage tables, GRANT/REVOKE. Anything else
-- fails here with 42501 instead of failing later in `supabase db push`.
-- Tests that really need such DDL can `set local supabase_stub.allow_reserved_ddl = on`.
-- ---------------------------------------------------------------------------
create schema supabase_stub;
revoke all on schema supabase_stub from public;

create function supabase_stub.reserved_schemas() returns text[] language sql immutable as $$
  select array['auth', 'storage', 'vault', 'cron', 'net', 'realtime', 'supabase_migrations', 'supabase_stub']
$$;

create function supabase_stub.guard_reserved_ddl() returns event_trigger
language plpgsql security definer set search_path = '' as $$
declare
  cmd record;
begin
  if coalesce(current_setting('supabase_stub.allow_reserved_ddl', true), '') = 'on' then
    return;
  end if;
  for cmd in select * from pg_event_trigger_ddl_commands() loop
    if cmd.schema_name = any (supabase_stub.reserved_schemas())
       and cmd.command_tag not in ('GRANT', 'REVOKE')
       and not (cmd.schema_name = 'auth' and cmd.object_type = 'trigger')
       and not (cmd.schema_name = 'storage' and cmd.object_type in ('policy', 'trigger')) then
      raise exception 'Supabase would reject % on % (managed schema "%")',
        cmd.command_tag, cmd.object_identity, cmd.schema_name
        using errcode = '42501',
              hint = 'Only triggers on auth tables and policies/triggers on storage tables are allowed there.';
    end if;
  end loop;
end
$$;

create function supabase_stub.guard_reserved_drop() returns event_trigger
language plpgsql security definer set search_path = '' as $$
declare
  obj record;
begin
  if coalesce(current_setting('supabase_stub.allow_reserved_ddl', true), '') = 'on' then
    return;
  end if;
  for obj in select * from pg_event_trigger_dropped_objects() loop
    if obj.schema_name = any (supabase_stub.reserved_schemas())
       and not (obj.schema_name = 'auth' and obj.object_type = 'trigger')
       and not (obj.schema_name = 'storage' and obj.object_type in ('policy', 'trigger')) then
      raise exception 'Supabase would reject dropping % % (managed schema "%")',
        obj.object_type, obj.object_identity, obj.schema_name
        using errcode = '42501';
    end if;
  end loop;
end
$$;

create event trigger supabase_stub_guard_reserved_ddl on ddl_command_end
  execute function supabase_stub.guard_reserved_ddl();
create event trigger supabase_stub_guard_reserved_drop on sql_drop
  execute function supabase_stub.guard_reserved_drop();
