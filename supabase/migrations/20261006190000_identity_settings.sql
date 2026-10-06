-- Migration 1 of P2a (SPEC §35.3): identity & settings.
--
-- Roles and policy helpers, customers with GR codes, invitations, staff tasks,
-- company settings and the generic audit log. Operations (orders, statuses,
-- documents) follow in migration 2, billing and messaging in migration 3.
--
-- Conventions used throughout (SPEC §35.3):
-- * Every table: RLS on, `revoke all` from anon/authenticated, then only the
--   verbs the app uses are granted back, one policy per command to authenticated.
-- * Privileged code lives in schema `private` as SECURITY DEFINER with an empty
--   search_path; nothing in `private` is executable by API roles.
-- * "Trusted" writes are those without an end user behind them (auth.uid() is
--   null): the service role, the Auth server and the SQL editor. Triggers only
--   enforce per-user rules when auth.uid() is set.
-- * Transaction-local flags (set_config(..., true)) let our own SECURITY DEFINER
--   code pass a guard. PostgREST cannot call set_config, so clients cannot set them.

-- ===========================================================================
-- Schema and types
-- ===========================================================================

create schema if not exists private;
revoke all on schema private from public, anon, authenticated, service_role;

do $$
begin
  if to_regtype('public.app_role') is null then
    create type public.app_role as enum ('admin', 'staff');
  end if;
  if to_regtype('public.account_type') is null then
    create type public.account_type as enum ('personal', 'business');
  end if;
  if to_regtype('public.customer_status') is null then
    create type public.customer_status as enum ('invited', 'active', 'disabled');
  end if;
  if to_regtype('public.invitation_kind') is null then
    create type public.invitation_kind as enum ('customer', 'staff');
  end if;
  if to_regtype('public.service_type') is null then
    create type public.service_type as enum ('air', 'sea');
  end if;
  if to_regtype('public.currency_code') is null then
    create type public.currency_code as enum ('USD', 'EUR', 'SRD');
  end if;
  if to_regtype('public.weight_rounding') is null then
    -- Always rounds up to the given step (SPEC §35.8).
    create type public.weight_rounding as enum ('none', '0.1', '0.5', '1');
  end if;
  if to_regtype('public.paper_size') is null then
    create type public.paper_size as enum ('Letter', 'A4');
  end if;
  if to_regtype('public.staff_task_kind') is null then
    create type public.staff_task_kind as enum (
      'signup_email_conflict', 'signup_customer_failed', 'order_cancellation_request'
    );
  end if;
end
$$;

-- Starts at 100 so imported legacy codes (GR000xx) stay free; never cycles, so
-- a generated number is never handed out twice (SPEC §35.5).
create sequence if not exists private.customer_number_seq
  as integer start with 100 minvalue 1 maxvalue 99999 no cycle;
revoke all on sequence private.customer_number_seq from public, anon, authenticated, service_role;

-- Numbers a customer gave up (code change or deletion). Labels and address
-- books may still carry them, so they are never given to anyone else
-- (SPEC §35.5: numbers are never reused). customer_id has no foreign key: the
-- row must outlive a deleted customer.
create table if not exists private.retired_customer_numbers (
  customer_number integer primary key,
  customer_id uuid,
  retired_at timestamptz not null default now(),
  constraint retired_customer_numbers_range check (customer_number between 1 and 99999)
);
revoke all on table private.retired_customer_numbers from public, anon, authenticated, service_role;

-- ===========================================================================
-- Tables
-- ===========================================================================

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_display_name_length check (char_length(display_name) <= 200)
);

create table if not exists public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  constraint user_roles_user_id_role_key unique (user_id, role)
);

-- customer_code is derived from customer_number by the database itself, so no
-- client or trigger can ever store a code that disagrees with the number.
create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  customer_number integer not null,
  customer_code text not null
    generated always as ('GR' || lpad(customer_number::text, 5, '0')) stored,
  account_type public.account_type not null default 'personal',
  full_name text not null,
  company_name text,
  kkf_number text,
  contact_person text,
  email text,
  phone text,
  address text,
  district text,
  status public.customer_status not null default 'active',
  terms_version text,
  terms_accepted_at timestamptz,
  disabled_at timestamptz,
  disabled_by uuid,
  disabled_reason text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  constraint customers_user_id_key unique (user_id),
  constraint customers_customer_number_key unique (customer_number),
  constraint customers_customer_code_key unique (customer_code),
  constraint customers_customer_number_range check (customer_number between 1 and 99999),
  constraint customers_full_name_check check (btrim(full_name) <> '' and char_length(full_name) <= 200),
  constraint customers_business_company_check
    check (account_type <> 'business' or nullif(btrim(company_name), '') is not null),
  constraint customers_email_check
    check (email is null or (email = lower(btrim(email)) and email ~ '^[^@\s]+@[^@\s]+$')),
  constraint customers_text_lengths check (
    char_length(company_name) <= 200 and char_length(kkf_number) <= 50
    and char_length(contact_person) <= 200 and char_length(email) <= 320
    and char_length(phone) <= 50 and char_length(address) <= 500
    and char_length(district) <= 100 and char_length(terms_version) <= 50
    and char_length(disabled_reason) <= 500)
);

create unique index if not exists customers_email_lower_key
  on public.customers (lower(email)) where email is not null;
create index if not exists customers_status_idx on public.customers (status);
create index if not exists customers_full_name_lower_idx on public.customers (lower(full_name));

-- The token itself is never stored: token_hash is the lowercase hex SHA-256 of
-- the 32-byte base64url token in the invitation link (SPEC §35.6).
create table if not exists public.invitations (
  id uuid primary key default gen_random_uuid(),
  kind public.invitation_kind not null,
  customer_id uuid references public.customers (id) on delete cascade,
  staff_role public.app_role,
  email text not null,
  token_hash text not null,
  expires_at timestamptz not null default (now() + interval '7 days'),
  last_sent_at timestamptz,
  send_count integer not null default 0,
  accepted_at timestamptz,
  accepted_by uuid,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  constraint invitations_token_hash_key unique (token_hash),
  constraint invitations_token_hash_format check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint invitations_kind_target_check check (
    (kind = 'customer' and customer_id is not null and staff_role is null)
    or (kind = 'staff' and staff_role is not null and customer_id is null)),
  constraint invitations_email_check
    check (email = lower(btrim(email)) and email ~ '^[^@\s]+@[^@\s]+$' and char_length(email) <= 320),
  constraint invitations_send_count_check check (send_count >= 0),
  constraint invitations_accepted_check check ((accepted_at is null) = (accepted_by is null))
);

create index if not exists invitations_customer_id_idx on public.invitations (customer_id);
create index if not exists invitations_kind_idx on public.invitations (kind);
create unique index if not exists invitations_one_open_per_customer
  on public.invitations (customer_id)
  where kind = 'customer' and accepted_at is null and revoked_at is null;
create unique index if not exists invitations_one_open_per_email
  on public.invitations (email)
  where accepted_at is null and revoked_at is null;

-- Work items for staff that the system raises (owner-approved addition to
-- SPEC §35.6/§35.7). order_id gets its foreign key in migration 2, which
-- creates public.orders. `email` is the address a sign-up task is about, so
-- redeeming an invitation for that address can close it.
create table if not exists public.staff_tasks (
  id uuid primary key default gen_random_uuid(),
  kind public.staff_task_kind not null,
  customer_id uuid references public.customers (id) on delete cascade,
  order_id uuid,
  email text,
  body text not null,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  resolved_at timestamptz,
  resolved_by uuid,
  constraint staff_tasks_body_check check (btrim(body) <> '' and char_length(body) <= 2000),
  constraint staff_tasks_email_check check (email = lower(btrim(email)) and char_length(email) <= 320)
);

create index if not exists staff_tasks_customer_id_idx on public.staff_tasks (customer_id);
create index if not exists staff_tasks_order_id_idx on public.staff_tasks (order_id);
create index if not exists staff_tasks_open_idx on public.staff_tasks (created_at) where resolved_at is null;
create index if not exists staff_tasks_open_email_idx on public.staff_tasks (email) where resolved_at is null;

create table if not exists public.company_settings (
  id boolean primary key default true,
  company_name text not null,
  tagline text,
  email text,
  phone text,
  address text,
  kkf_number text,
  btw_number text,
  invoice_title text not null,
  footer_text text,
  payment_terms_text text,
  payment_term_days integer not null default 7,
  late_fee_percent numeric(5, 2) not null default 15,
  due_soon_days integer not null default 2,
  overdue_reminder_interval_days integer not null default 7,
  max_overdue_reminders integer not null default 3,
  default_currency public.currency_code not null default 'USD',
  vat_rate_percent numeric(5, 2),
  show_vat_breakdown boolean not null default false,
  invoice_number_prefix text not null default 'INV-',
  paper_size public.paper_size not null default 'Letter',
  public_signup_enabled boolean not null default true,
  pay_before_pickup boolean not null default true,
  delivery_available boolean not null default false,
  -- Orders a customer may have registered themselves that G&R has not yet
  -- received. Public sign-up is open, so this bounds what one account can
  -- create; staff register orders without this limit.
  max_open_orders_per_customer integer not null default 50,
  pickup_address text,
  pickup_hours text,
  pickup_instructions text,
  terms_markdown text,
  terms_version text not null default '1',
  prohibited_goods_markdown text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  constraint company_settings_singleton check (id),
  constraint company_settings_payment_term_days check (payment_term_days between 0 and 365),
  constraint company_settings_late_fee_percent check (late_fee_percent between 0 and 100),
  constraint company_settings_due_soon_days check (due_soon_days between 0 and 60),
  constraint company_settings_reminder_interval check (overdue_reminder_interval_days between 1 and 365),
  constraint company_settings_max_reminders check (max_overdue_reminders between 0 and 50),
  constraint company_settings_vat_rate check (vat_rate_percent between 0 and 100),
  constraint company_settings_invoice_prefix check (char_length(invoice_number_prefix) <= 20),
  constraint company_settings_max_open_orders check (max_open_orders_per_customer between 1 and 10000),
  constraint company_settings_terms_version check (btrim(terms_version) <> '' and char_length(terms_version) <= 50)
);

create table if not exists public.company_bank_accounts (
  id uuid primary key default gen_random_uuid(),
  currency public.currency_code not null,
  bank_name text,
  account_holder text,
  account_number text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);

-- The invoice prints exactly one account per currency (SPEC §35.11).
create unique index if not exists company_bank_accounts_one_active_per_currency
  on public.company_bank_accounts (currency) where is_active;
create index if not exists company_bank_accounts_is_active_idx on public.company_bank_accounts (is_active);

create table if not exists public.warehouse_addresses (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  service_type public.service_type not null,
  recipient_name_template text not null default '{FULL_NAME} {GR_CODE}',
  address_line1 text not null,
  address_line2_template text not null default '{GR_CODE}',
  city text not null,
  state text not null,
  zip text not null,
  country text not null default 'USA',
  phone text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);

create index if not exists warehouse_addresses_is_active_idx on public.warehouse_addresses (is_active);

create table if not exists public.service_rates (
  service_type public.service_type primary key,
  enabled boolean not null default false,
  rate_per_lb numeric(12, 2),
  currency public.currency_code not null default 'USD',
  minimum_billable_lbs numeric(10, 2),
  weight_rounding public.weight_rounding not null default 'none',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  constraint service_rates_rate_check check (rate_per_lb >= 0),
  constraint service_rates_minimum_check check (minimum_billable_lbs >= 0)
);

create index if not exists service_rates_enabled_idx on public.service_rates (enabled);

-- `reason` carries the mandatory justification of admin actions (code change,
-- pickup override, cancellations), set via app.audit_reason by the RPC.
create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  actor_id uuid,
  table_name text not null,
  record_id text,
  action text not null,
  old_data jsonb,
  new_data jsonb,
  changed_columns text[],
  reason text,
  constraint audit_log_action_check check (action in ('INSERT', 'UPDATE', 'DELETE'))
);

create index if not exists audit_log_table_record_idx on public.audit_log (table_name, record_id);
create index if not exists audit_log_occurred_at_idx on public.audit_log (occurred_at);
create index if not exists audit_log_actor_id_idx on public.audit_log (actor_id);

-- ===========================================================================
-- Seeds: configuration only (SPEC §35.3, §35.8). Placeholders, never legal text.
-- ===========================================================================

insert into public.company_settings (
  id, company_name, tagline, email, phone, address, kkf_number, btw_number,
  invoice_title, footer_text, payment_terms_text,
  payment_term_days, late_fee_percent, due_soon_days, overdue_reminder_interval_days,
  max_overdue_reminders, default_currency, vat_rate_percent, show_vat_breakdown,
  invoice_number_prefix, paper_size, public_signup_enabled, pay_before_pickup,
  delivery_available, pickup_address, pickup_hours, pickup_instructions,
  terms_markdown, terms_version, prohibited_goods_markdown
) values (
  true, 'G&R SOLUTIONS N.V.', 'CUSTOMS BROKERAGE & LOGISTICS', 'info@grsolutions.sr',
  '5978897500', 'kwattaweg #22', null, null,
  'INVOICE (inclusief BTW)', 'G&R SOLUTIONS N.V.  |  CUSTOMS BROKERAGE & LOGISTICS',
  'Deze factuur dient binnen 1 week na factuurdatum volledig te worden betaald. Na het verstrijken van deze betalingstermijn wordt een opslag van 15% op het openstaande bedrag in rekening gebracht.',
  7, 15, 2, 7,
  3, 'USD', null, false,
  'INV-', 'Letter', true, true,
  false, 'Kwattaweg #22, Paramaribo', null, 'Neem een geldig legitimatiebewijs en uw klantcode mee',
  '_Placeholder: de algemene voorwaarden van G&R Solutions N.V. worden hier gepubliceerd._',
  '1',
  '_Placeholder: de lijst met verboden goederen van G&R Solutions N.V. wordt hier gepubliceerd._'
) on conflict (id) do nothing;

insert into public.company_bank_accounts (currency, sort_order)
values ('USD', 1), ('EUR', 2), ('SRD', 3)
on conflict (currency) where is_active do nothing;

insert into public.service_rates (service_type, enabled, rate_per_lb, currency, minimum_billable_lbs, weight_rounding)
values ('air', true, null, 'USD', null, 'none'),
       ('sea', false, null, 'USD', null, 'none')
on conflict (service_type) do nothing;

-- ===========================================================================
-- Policy helpers (SPEC §35.4). SECURITY DEFINER so policies on user_roles and
-- customers can call them without recursing into their own RLS.
-- ===========================================================================

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_roles r where r.user_id = _user_id and r.role = _role
  )
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_role((select auth.uid()), 'admin')
$$;

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_roles r
    where r.user_id = (select auth.uid()) and r.role in ('admin', 'staff')
  )
$$;

-- Only an ACTIVE linked customer counts, so a disabled customer sees nothing.
create or replace function public.current_customer_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select c.id from public.customers c
  where c.user_id = (select auth.uid()) and c.status = 'active'
$$;

-- ===========================================================================
-- Private helpers
-- ===========================================================================

-- "gr00017", " GR 17 " and "17" all mean 17 (SPEC §35.5).
create or replace function private.parse_customer_code(_input text)
returns integer
language plpgsql
immutable
set search_path = ''
as $$
declare
  _digits text := upper(regexp_replace(coalesce(_input, ''), '\s', '', 'g'));
begin
  if left(_digits, 2) = 'GR' then
    _digits := substr(_digits, 3);
  end if;
  if _digits !~ '^[0-9]{1,5}$' or _digits::integer = 0 then
    raise exception 'Ongeldige klantcode "%": gebruik GR gevolgd door 1 tot 5 cijfers', coalesce(_input, '')
      using errcode = '22023';
  end if;
  return _digits::integer;
end
$$;

-- Whether a number is free for a new holder: nobody has it and nobody gave it
-- up. Numbers typed in above the generator's position are skipped this way too.
create or replace function private.customer_number_available(_n integer)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (select 1 from public.customers c where c.customer_number = _n)
     and not exists (select 1 from private.retired_customer_numbers r where r.customer_number = _n)
$$;

-- Skips numbers that are taken or retired. The sequence stops at 99999
-- instead of wrapping, so nothing is ever reissued.
create or replace function private.next_customer_number()
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  _n integer;
begin
  loop
    _n := nextval('private.customer_number_seq');
    exit when private.customer_number_available(_n);
  end loop;
  return _n;
end
$$;

-- Whether a customer already has orders or issued invoices, which freezes the
-- GR code (SPEC §35.5). Those tables arrive in migrations 2 and 3, so this
-- looks them up at run time; once they exist it starts enforcing by itself.
-- Migration 3 may replace it with static SQL (same signature).
create or replace function private.customer_has_activity(_customer_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  _found boolean := false;
begin
  if to_regclass('public.orders') is not null then
    execute 'select exists (select 1 from public.orders o where o.customer_id = $1)'
      into _found using _customer_id;
    if _found then
      return true;
    end if;
  end if;
  if to_regclass('public.invoices') is not null then
    execute 'select exists (select 1 from public.invoices i where i.customer_id = $1 and i.status <> ''draft'')'
      into _found using _customer_id;
  end if;
  return _found;
end
$$;

-- Inserts a customer, retrying when a GENERATED number loses a race against a
-- concurrent insert of the same number (SPEC §35.5: up to 5 attempts).
create or replace function private.insert_customer(_c public.customers)
returns public.customers
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  _row public.customers;
  _constraint text;
begin
  for _attempt in 1..5 loop
    begin
      insert into public.customers (
        user_id, customer_number, account_type, full_name, company_name, kkf_number,
        contact_person, email, phone, address, district, status, terms_version,
        terms_accepted_at, created_by, updated_by
      ) values (
        _c.user_id, _c.customer_number, coalesce(_c.account_type, 'personal'), _c.full_name,
        _c.company_name, _c.kkf_number, _c.contact_person, _c.email, _c.phone, _c.address,
        _c.district, coalesce(_c.status, 'active'), _c.terms_version, _c.terms_accepted_at,
        coalesce(_c.created_by, (select auth.uid())), coalesce(_c.updated_by, (select auth.uid()))
      )
      returning * into _row;
      return _row;
    exception when unique_violation then
      get stacked diagnostics _constraint = constraint_name;
      if _c.customer_number is not null
         or _constraint is distinct from 'customers_customer_number_key'
         or _attempt = 5 then
        raise;
      end if;
    end;
  end loop;
  return null;  -- not reached: the last attempt re-raises
end
$$;

-- ===========================================================================
-- Trigger functions
-- ===========================================================================

-- jsonb_populate_record ignores keys the table lacks, so one function serves
-- tables with and without updated_by.
create or replace function private.touch_updated_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid uuid := (select auth.uid());
begin
  new := jsonb_populate_record(
    new,
    jsonb_build_object('updated_at', now())
      || case when _uid is null then '{}'::jsonb else jsonb_build_object('updated_by', _uid) end
  );
  return new;
end
$$;

-- Generic audit writer (SPEC §35.13). Optional trigger argument: the primary
-- key column when it is not "id". token_hash never reaches the log.
create or replace function private.audit_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  _old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) - 'token_hash' end;
  _new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) - 'token_hash' end;
  _row jsonb := to_jsonb(coalesce(new, old));
  _changed text[];
begin
  if tg_op = 'UPDATE' then
    select array_agg(n.key order by n.key) into _changed
    from jsonb_each(_new) n
    where n.key not in ('updated_at', 'updated_by')
      and n.value is distinct from (_old -> n.key);
    if _changed is null then
      return null;  -- only the touch columns moved: nothing to audit
    end if;
  end if;

  insert into public.audit_log (
    actor_id, table_name, record_id, action, old_data, new_data, changed_columns, reason
  ) values (
    coalesce((select auth.uid()), (_row ->> 'updated_by')::uuid, (_row ->> 'created_by')::uuid),
    tg_table_name,
    _row ->> coalesce(tg_argv[0], 'id'),
    tg_op,
    _old,
    _new,
    _changed,
    nullif(current_setting('app.audit_reason', true), '')
  );
  return null;
end
$$;

-- Who may write which customer columns (SPEC §35.5). Runs before
-- customers_set_code (trigger names sort alphabetically).
create or replace function private.customers_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid uuid := (select auth.uid());
  _admin boolean;
begin
  new.email := nullif(lower(btrim(new.email)), '');

  if _uid is not null and coalesce(current_setting('app.customers_internal_write', true), '') <> 'on' then
    _admin := public.is_admin();

    if tg_op = 'INSERT' then
      if not public.is_staff() then
        raise exception 'Geen toegang' using errcode = '42501';
      end if;
      -- An existing GR code is linked to a login ONLY by redeeming an invitation.
      if new.user_id is not null then
        raise exception 'Geen toegang: een login wordt alleen via een uitnodiging gekoppeld'
          using errcode = '42501';
      end if;
      if new.status = 'disabled' and not _admin then
        raise exception 'Geen toegang: alleen een beheerder kan een klant deactiveren' using errcode = '42501';
      end if;
      new.created_at := now();
      new.created_by := _uid;
      new.updated_by := _uid;
    else
      -- Even admins change a code only through change_customer_code(), which
      -- checks the reason and the "no orders or issued invoices" rule.
      if new.customer_number is distinct from old.customer_number
         and coalesce(current_setting('app.customer_code_change', true), '') <> 'on' then
        raise exception 'Geen toegang: een klantcode wijzigt alleen via "Code wijzigen"'
          using errcode = '42501';
      end if;
      if new.created_at is distinct from old.created_at or new.created_by is distinct from old.created_by then
        raise exception 'Geen toegang' using errcode = '42501';
      end if;
      if not _admin and (
           new.user_id is distinct from old.user_id
        or new.status is distinct from old.status
        or new.email is distinct from old.email
        or new.disabled_at is distinct from old.disabled_at
        or new.disabled_by is distinct from old.disabled_by
        or new.disabled_reason is distinct from old.disabled_reason) then
        raise exception 'Geen toegang: alleen een beheerder mag login, status of e-mailadres wijzigen'
          using errcode = '42501';
      end if;
    end if;
  end if;

  if tg_op = 'INSERT' then
    if new.status = 'disabled' then
      new.disabled_at := coalesce(new.disabled_at, now());
      new.disabled_by := coalesce(_uid, new.disabled_by);
    else
      new.disabled_at := null;
      new.disabled_by := null;
      new.disabled_reason := null;
    end if;
  elsif new.status is distinct from old.status then
    if new.status = 'disabled' then
      new.disabled_at := now();
      new.disabled_by := coalesce(_uid, new.disabled_by);
    elsif old.status = 'disabled' then
      new.disabled_at := null;
      new.disabled_by := null;
      new.disabled_reason := null;
    end if;
  end if;
  return new;
end
$$;

-- Assigns the customer number and turns duplicates into the Dutch message the
-- admin sees (SPEC §35.5); the unique indexes still back this up under races.
create or replace function private.customers_set_code()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  _other record;
begin
  if tg_op = 'INSERT' and new.customer_number is null then
    new.customer_number := private.next_customer_number();
  elsif tg_op = 'INSERT' or new.customer_number is distinct from old.customer_number then
    if new.customer_number not between 1 and 99999 then
      raise exception 'Een klantcode heeft 1 tot 5 cijfers (GR00001 t/m GR99999)' using errcode = '22023';
    end if;
    select c.full_name into _other
    from public.customers c
    where c.customer_number = new.customer_number and c.id <> new.id;
    if found then
      raise exception '% is al toegewezen aan %', 'GR' || lpad(new.customer_number::text, 5, '0'), _other.full_name
        using errcode = '23505', constraint = 'customers_customer_number_key';
    end if;
    -- Only the customer who gave a number up may take it back (an undone
    -- code change); packages may still be labelled with it.
    if exists (
      select 1 from private.retired_customer_numbers r
      where r.customer_number = new.customer_number and r.customer_id is distinct from new.id
    ) then
      raise exception '% is eerder gebruikt en wordt niet opnieuw uitgegeven', 'GR' || lpad(new.customer_number::text, 5, '0')
        using errcode = '23505', constraint = 'customers_customer_number_key';
    end if;
  end if;

  if new.email is not null and (tg_op = 'INSERT' or new.email is distinct from old.email) then
    select c.full_name, c.customer_code into _other
    from public.customers c
    where lower(c.email) = new.email and c.id <> new.id;
    if found then
      raise exception 'E-mailadres % is al in gebruik bij % (%)', new.email, _other.customer_code, _other.full_name
        using errcode = '23505', constraint = 'customers_email_lower_key';
    end if;
  end if;
  return new;
end
$$;

-- Records every number a customer gives up, whichever path freed it
-- (change_customer_code or a delete in the SQL editor).
create or replace function private.customers_retire_number()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.customer_number = old.customer_number then
    return null;
  end if;
  insert into private.retired_customer_numbers as r (customer_number, customer_id, retired_at)
  values (old.customer_number, old.id, now())
  on conflict (customer_number) do update set customer_id = excluded.customer_id, retired_at = excluded.retired_at;
  if tg_op = 'UPDATE' then
    -- Taken back by the same customer: in use again, so no longer retired.
    delete from private.retired_customer_numbers r where r.customer_number = new.customer_number;
  end if;
  return null;
end
$$;

-- An open invitation was sent to the address the customer had at the time.
-- Once an admin corrects that address, the old link must stop working; the
-- customer drops back to 'active' through invitations_sync_customer.
create or replace function private.customers_revoke_stale_invitations()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.invitations i
     set revoked_at = now()
   where i.kind = 'customer'
     and i.customer_id = new.id
     and i.accepted_at is null
     and i.revoked_at is null
     and i.email is distinct from new.email;
  return null;
end
$$;

-- An invitation is only as good as its inviter's current rights: when a user
-- loses a role, the open invitations they could no longer create are revoked
-- (staff invitations need an admin, customer invitations any staff member).
-- Also covers roles removed by deleting the Auth user (cascade).
create or replace function private.user_roles_revoke_invitations()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  _admin boolean := public.has_role(old.user_id, 'admin');
  _staff boolean := _admin or public.has_role(old.user_id, 'staff');
begin
  update public.invitations i
     set revoked_at = now()
   where i.created_by = old.user_id
     and i.accepted_at is null
     and i.revoked_at is null
     and ((i.kind = 'staff' and not _admin) or not _staff);
  return null;
end
$$;

-- Staff write invitations with their own client (owner decision); this keeps
-- them to creating, rotating (resend) and revoking, and applies the resend
-- limits of SPEC §35.6: once per minute, five times per Suriname day.
create or replace function private.invitations_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid uuid := (select auth.uid());
  _today date := (now() at time zone 'America/Paramaribo')::date;
  _customer record;
  _rotated boolean := false;
begin
  new.email := lower(btrim(new.email));
  if tg_op = 'UPDATE' then
    _rotated := new.token_hash is distinct from old.token_hash;
  end if;

  if tg_op = 'INSERT' then
    if _uid is not null then
      -- BEFORE triggers run ahead of the RLS check: deny first, so outsiders
      -- never learn anything from the validation messages below.
      if not public.is_staff() or (new.kind = 'staff' and not public.is_admin()) then
        raise exception 'Geen toegang' using errcode = '42501';
      end if;
      new.created_at := now();
      new.created_by := _uid;
      new.updated_by := _uid;
      new.expires_at := now() + interval '7 days';
      new.accepted_at := null;
      new.accepted_by := null;
      new.revoked_at := null;
    end if;
    new.last_sent_at := now();
    new.send_count := 1;
  elsif _uid is not null then
    if (new.kind, new.customer_id, new.staff_role, new.email, new.created_at, new.created_by,
        new.accepted_at, new.accepted_by, new.expires_at, new.last_sent_at, new.send_count)
       is distinct from
       (old.kind, old.customer_id, old.staff_role, old.email, old.created_at, old.created_by,
        old.accepted_at, old.accepted_by, old.expires_at, old.last_sent_at, old.send_count) then
      raise exception 'Geen toegang: een uitnodiging kan alleen opnieuw verstuurd of ingetrokken worden'
        using errcode = '42501';
    end if;
    if old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at then
      raise exception 'Een ingetrokken uitnodiging kan niet worden heropend' using errcode = '55000';
    end if;
    if old.revoked_at is null and new.revoked_at is not null then
      if old.accepted_at is not null then
        raise exception 'Deze uitnodiging is al geaccepteerd' using errcode = '55000';
      end if;
      new.revoked_at := now();
    end if;
  end if;

  if _rotated then
    if old.accepted_at is not null or old.revoked_at is not null or new.revoked_at is not null then
      raise exception 'Deze uitnodiging is niet meer open' using errcode = '55000';
    end if;
    if _uid is not null then
      if old.last_sent_at > now() - interval '1 minute' then
        raise exception 'Wacht een minuut voordat u de uitnodiging opnieuw verstuurt' using errcode = '55000';
      end if;
      if (old.last_sent_at at time zone 'America/Paramaribo')::date = _today and old.send_count >= 5 then
        raise exception 'Deze uitnodiging is vandaag al 5 keer verstuurd' using errcode = '55000';
      end if;
    end if;
    new.send_count := case
      when (old.last_sent_at at time zone 'America/Paramaribo')::date = _today then old.send_count + 1
      else 1
    end;
    new.last_sent_at := now();
    new.expires_at := now() + interval '7 days';
  end if;

  if new.kind = 'customer' and (tg_op = 'INSERT' or _rotated) then
    select c.user_id, c.status, c.email into _customer
    from public.customers c where c.id = new.customer_id;
    if not found then
      raise exception 'Klant niet gevonden' using errcode = 'P0002';
    end if;
    if _customer.user_id is not null then
      raise exception 'Deze klant heeft al een account' using errcode = '55000';
    end if;
    if _customer.status = 'disabled' then
      raise exception 'Deze klant is gedeactiveerd' using errcode = '55000';
    end if;
    if _customer.email is null or _customer.email <> new.email then
      raise exception 'Een uitnodiging gaat altijd naar het e-mailadres van het klantdossier' using errcode = '22023';
    end if;
  end if;
  return new;
end
$$;

-- Keeps customers.status in step with invitations: an unlinked customer with an
-- open invitation is 'invited', otherwise 'active'. Redemption sets 'active'
-- together with user_id.
create or replace function private.invitations_sync_customer()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  _target public.customer_status;
begin
  if new.kind <> 'customer' then
    return null;
  end if;
  _target := case
    when exists (
      select 1 from public.invitations i
      where i.customer_id = new.customer_id and i.accepted_at is null and i.revoked_at is null
    ) then 'invited'
    else 'active'
  end;
  perform set_config('app.customers_internal_write', 'on', true);
  update public.customers c
     set status = _target
   where c.id = new.customer_id
     and c.user_id is null
     and c.status in ('active', 'invited')
     and c.status <> _target;
  perform set_config('app.customers_internal_write', '', true);
  return null;
end
$$;

create or replace function private.staff_tasks_stamp()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid uuid := (select auth.uid());
begin
  if tg_op = 'INSERT' then
    if _uid is not null then
      new.created_at := now();
      new.created_by := _uid;
    end if;
    if new.resolved_at is not null then
      new.resolved_by := coalesce(_uid, new.resolved_by);
    end if;
  else
    if _uid is not null then
      new.created_at := old.created_at;
      new.created_by := old.created_by;
    end if;
    if new.resolved_at is distinct from old.resolved_at then
      new.resolved_by := case when new.resolved_at is null then null else coalesce(_uid, new.resolved_by) end;
    end if;
  end if;
  return new;
end
$$;

-- Sign-up hook on auth.users (SPEC §35.6). Always ensures a profile; creates a
-- customer only once the e-mail is confirmed, and only from display fields of
-- raw_user_meta_data (users control that JSON). An e-mail that G&R already
-- knows is never auto-linked: staff get a task and the person needs their
-- invitation link.
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  _meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  _email text := nullif(lower(btrim(new.email)), '');
  _c public.customers;
  _known_customer_id uuid;
  _known_code text;
  _constraint text;
begin
  _c.full_name := left(nullif(btrim(_meta ->> 'full_name'), ''), 200);

  insert into public.profiles (id, display_name)
  values (new.id, _c.full_name)
  on conflict (id) do nothing;

  if new.email_confirmed_at is null
     or _email is null
     or nullif(new.raw_app_meta_data ->> 'invitation_id', '') is not null
     or exists (select 1 from public.user_roles r where r.user_id = new.id)
     or exists (select 1 from public.customers c where c.user_id = new.id) then
    return null;
  end if;
  -- The switch also holds for sign-ups made straight against the Auth API.
  if not coalesce((select s.public_signup_enabled from public.company_settings s where s.id), true) then
    return null;
  end if;

  -- Someone invited as staff gets no customer record; the invitation link
  -- (path b or c of SPEC §35.6) grants the role. Nothing for staff to do.
  if exists (
    select 1 from public.invitations i
    where i.email = _email and i.kind = 'staff' and i.accepted_at is null and i.revoked_at is null
  ) then
    return null;
  end if;

  select c.id, c.customer_code into _known_customer_id, _known_code
  from public.customers c where lower(c.email) = _email;
  if not found then
    select i.customer_id into _known_customer_id
    from public.invitations i
    where i.email = _email and i.kind = 'customer' and i.accepted_at is null and i.revoked_at is null;
  end if;
  if found then
    perform private.add_staff_task(
      'signup_email_conflict',
      _known_customer_id,
      format(
        'Nieuwe registratie van %s (%s) is niet gekoppeld: G&R heeft al een klantdossier%s of een open uitnodiging voor dit e-mailadres. Stuur de klant een (nieuwe) uitnodigingslink.',
        coalesce(_c.full_name, 'onbekend'), _email,
        case when _known_code is null then '' else ' (' || _known_code || ')' end),
      _email => _email);
    return null;
  end if;

  _c.user_id := new.id;
  _c.email := _email;
  _c.full_name := coalesce(_c.full_name, left(split_part(_email, '@', 1), 200));
  _c.phone := left(coalesce(nullif(btrim(_meta ->> 'phone'), ''), new.phone), 50);
  _c.company_name := left(nullif(btrim(_meta ->> 'company_name'), ''), 200);
  _c.account_type := case
    when _meta ->> 'account_type' = 'business' and _c.company_name is not null then 'business'
    else 'personal'
  end::public.account_type;
  if _c.account_type = 'personal' then
    _c.company_name := null;
  end if;
  _c.terms_version := left(nullif(btrim(_meta ->> 'terms_version'), ''), 50);
  _c.terms_accepted_at := case when _c.terms_version is not null then coalesce(new.created_at, now()) end;
  _c.status := 'active';
  _c.created_by := new.id;
  _c.updated_by := new.id;

  -- Never block the Auth server: if the customer cannot be created, the user
  -- still gets confirmed and staff get a task to sort it out.
  begin
    perform private.insert_customer(_c);
  exception when others then
    get stacked diagnostics _constraint = constraint_name;
    -- customers_user_id_key: a concurrent confirmation already created it.
    if _constraint is distinct from 'customers_user_id_key' then
      perform private.add_staff_task(
        'signup_customer_failed',
        null,
        format(
          'Nieuwe registratie van %s (%s): het klantdossier kon niet automatisch worden aangemaakt (%s). Maak de klant handmatig aan en stuur een uitnodigingslink.',
          coalesce(_c.full_name, 'onbekend'), _email, sqlerrm),
        _email => _email);
    end if;
  end;
  return null;
end
$$;

-- Raises a task for staff. Sign-up confirmations can be replayed, so an
-- identical open task is not added twice.
create or replace function private.add_staff_task(
  _kind public.staff_task_kind,
  _customer_id uuid,
  _body text,
  _order_id uuid default null,
  _email text default null
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  _text text := left(_body, 2000);
begin
  if not exists (
    select 1 from public.staff_tasks t
    where t.kind = _kind and t.resolved_at is null
      and t.customer_id is not distinct from _customer_id
      and t.order_id is not distinct from _order_id
      and t.email is not distinct from _email
      and t.body = _text
  ) then
    insert into public.staff_tasks (kind, customer_id, order_id, email, body, created_by)
    values (_kind, _customer_id, _order_id, _email, _text, (select auth.uid()));
  end if;
end
$$;

-- ===========================================================================
-- Triggers
-- ===========================================================================

drop trigger if exists handle_new_user on auth.users;
create trigger handle_new_user
  after insert or update of email_confirmed_at on auth.users
  for each row execute function private.handle_new_user();

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function private.touch_updated_at();

drop trigger if exists user_roles_audit on public.user_roles;
create trigger user_roles_audit
  after insert or update or delete on public.user_roles
  for each row execute function private.audit_row();

drop trigger if exists user_roles_revoke_invitations on public.user_roles;
create trigger user_roles_revoke_invitations
  after update or delete on public.user_roles
  for each row execute function private.user_roles_revoke_invitations();

drop trigger if exists customers_guard on public.customers;
create trigger customers_guard
  before insert or update on public.customers
  for each row execute function private.customers_guard();

drop trigger if exists customers_set_code on public.customers;
create trigger customers_set_code
  before insert or update on public.customers
  for each row execute function private.customers_set_code();

drop trigger if exists customers_touch_updated_at on public.customers;
create trigger customers_touch_updated_at
  before update on public.customers
  for each row execute function private.touch_updated_at();

drop trigger if exists customers_audit on public.customers;
create trigger customers_audit
  after insert or update or delete on public.customers
  for each row execute function private.audit_row();

drop trigger if exists customers_retire_number on public.customers;
create trigger customers_retire_number
  after update of customer_number or delete on public.customers
  for each row execute function private.customers_retire_number();

drop trigger if exists customers_revoke_stale_invitations on public.customers;
create trigger customers_revoke_stale_invitations
  after update of email on public.customers
  for each row when (old.email is distinct from new.email)
  execute function private.customers_revoke_stale_invitations();

drop trigger if exists invitations_guard on public.invitations;
create trigger invitations_guard
  before insert or update on public.invitations
  for each row execute function private.invitations_guard();

drop trigger if exists invitations_touch_updated_at on public.invitations;
create trigger invitations_touch_updated_at
  before update on public.invitations
  for each row execute function private.touch_updated_at();

drop trigger if exists invitations_audit on public.invitations;
create trigger invitations_audit
  after insert or update or delete on public.invitations
  for each row execute function private.audit_row();

drop trigger if exists invitations_sync_customer on public.invitations;
create trigger invitations_sync_customer
  after insert or update of accepted_at, revoked_at on public.invitations
  for each row execute function private.invitations_sync_customer();

drop trigger if exists staff_tasks_stamp on public.staff_tasks;
create trigger staff_tasks_stamp
  before insert or update on public.staff_tasks
  for each row execute function private.staff_tasks_stamp();

drop trigger if exists company_settings_touch_updated_at on public.company_settings;
create trigger company_settings_touch_updated_at
  before update on public.company_settings
  for each row execute function private.touch_updated_at();

drop trigger if exists company_settings_audit on public.company_settings;
create trigger company_settings_audit
  after insert or update or delete on public.company_settings
  for each row execute function private.audit_row();

drop trigger if exists company_bank_accounts_touch_updated_at on public.company_bank_accounts;
create trigger company_bank_accounts_touch_updated_at
  before update on public.company_bank_accounts
  for each row execute function private.touch_updated_at();

drop trigger if exists company_bank_accounts_audit on public.company_bank_accounts;
create trigger company_bank_accounts_audit
  after insert or update or delete on public.company_bank_accounts
  for each row execute function private.audit_row();

drop trigger if exists warehouse_addresses_touch_updated_at on public.warehouse_addresses;
create trigger warehouse_addresses_touch_updated_at
  before update on public.warehouse_addresses
  for each row execute function private.touch_updated_at();

drop trigger if exists warehouse_addresses_audit on public.warehouse_addresses;
create trigger warehouse_addresses_audit
  after insert or update or delete on public.warehouse_addresses
  for each row execute function private.audit_row();

drop trigger if exists service_rates_touch_updated_at on public.service_rates;
create trigger service_rates_touch_updated_at
  before update on public.service_rates
  for each row execute function private.touch_updated_at();

drop trigger if exists service_rates_audit on public.service_rates;
create trigger service_rates_audit
  after insert or update or delete on public.service_rates
  for each row execute function private.audit_row('service_type');

-- ===========================================================================
-- RPCs for signed-in users. Each starts with its access guard (SPEC §35.3).
-- ===========================================================================

create or replace function public.set_user_role(_user_id uuid, _role public.app_role, _grant boolean)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not (select public.is_admin()) then
    raise exception 'Geen toegang' using errcode = '42501';
  end if;
  if _user_id is null or _role is null or _grant is null then
    raise exception 'Gebruiker, rol en actie zijn verplicht' using errcode = '22023';
  end if;
  if not exists (select 1 from auth.users u where u.id = _user_id) then
    raise exception 'Gebruiker niet gevonden' using errcode = 'P0002';
  end if;

  if _grant then
    insert into public.user_roles (user_id, role, created_by)
    values (_user_id, _role, (select auth.uid()))
    on conflict (user_id, role) do nothing;
    return;
  end if;

  if _role = 'admin' then
    -- Lock all admin rows so two concurrent demotions cannot both pass.
    perform 1 from public.user_roles r where r.role = 'admin' for update;
    if exists (select 1 from public.user_roles r where r.user_id = _user_id and r.role = 'admin')
       and (select count(*) from public.user_roles r where r.role = 'admin') <= 1 then
      raise exception 'De laatste beheerder kan niet worden verwijderd' using errcode = '55000';
    end if;
  end if;
  delete from public.user_roles r where r.user_id = _user_id and r.role = _role;
end
$$;

-- What the next generated GR number will be (for the "Klant toevoegen" form).
create or replace function public.peek_next_customer_number()
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  _last integer;
  _called boolean;
  _n integer;
begin
  if not (select public.is_staff()) then
    raise exception 'Geen toegang' using errcode = '42501';
  end if;
  select s.last_value, s.is_called into _last, _called from private.customer_number_seq s;
  _n := case when _called then _last + 1 else _last end;
  while not private.customer_number_available(_n) loop
    _n := _n + 1;
  end loop;
  return _n;
end
$$;

-- Accepts only numbers above every existing number, above anything the
-- generator already issued and above every retired number, so numbers are
-- never reused (SPEC §35.5).
create or replace function public.set_next_customer_number(_next integer)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  _max integer;
  _last integer;
  _called boolean;
  _retired integer;
begin
  if not (select public.is_admin()) then
    raise exception 'Geen toegang' using errcode = '42501';
  end if;
  if _next is null or _next not between 1 and 99999 then
    raise exception 'Het volgende klantnummer moet tussen 1 en 99999 liggen' using errcode = '22023';
  end if;
  select coalesce(max(c.customer_number), 0) into _max from public.customers c;
  if _next <= _max then
    raise exception 'Het volgende klantnummer moet hoger zijn dan het hoogste bestaande nummer (GR%)',
      lpad(_max::text, 5, '0') using errcode = '22023';
  end if;
  select s.last_value, s.is_called into _last, _called from private.customer_number_seq s;
  if _called and _next <= _last then
    raise exception 'GR% is al eens uitgegeven; kies een nummer hoger dan GR%',
      lpad(_next::text, 5, '0'), lpad(_last::text, 5, '0') using errcode = '22023';
  end if;
  select max(r.customer_number) into _retired from private.retired_customer_numbers r;
  if _next <= _retired then
    raise exception 'GR% is eerder gebruikt en wordt niet opnieuw uitgegeven; kies een nummer hoger dan dat',
      lpad(_retired::text, 5, '0') using errcode = '22023';
  end if;

  perform setval('private.customer_number_seq', _next, false);
  insert into public.audit_log (actor_id, table_name, record_id, action, old_data, new_data, changed_columns)
  values ((select auth.uid()), 'customer_number_seq', 'next', 'UPDATE',
          jsonb_build_object('next', case when _called then _last + 1 else _last end),
          jsonb_build_object('next', _next), array['next']);
  return _next;
end
$$;

create or replace function public.change_customer_code(_id uuid, _code text, _reason text)
returns public.customers
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  _row public.customers;
  _n integer;
begin
  if not (select public.is_admin()) then
    raise exception 'Geen toegang' using errcode = '42501';
  end if;
  if nullif(btrim(_reason), '') is null then
    raise exception 'Een reden is verplicht' using errcode = '22023';
  end if;
  select * into _row from public.customers c where c.id = _id for update;
  if not found then
    raise exception 'Klant niet gevonden' using errcode = 'P0002';
  end if;
  _n := private.parse_customer_code(_code);
  if _n = _row.customer_number then
    return _row;
  end if;
  if private.customer_has_activity(_id) then
    raise exception 'De code van % kan niet meer worden gewijzigd: de klant heeft al orders of uitgegeven facturen',
      _row.customer_code using errcode = '55000';
  end if;

  perform set_config('app.customer_code_change', 'on', true);
  perform set_config('app.audit_reason', left(btrim(_reason), 500), true);
  update public.customers c set customer_number = _n where c.id = _id returning * into _row;
  perform set_config('app.customer_code_change', '', true);
  perform set_config('app.audit_reason', '', true);
  return _row;
end
$$;

-- "Klant toevoegen" (SPEC §35.5): no invitation, no login. Name and phone are
-- required; e-mail and an existing GR code are optional.
create or replace function public.create_customer(
  _full_name text,
  _phone text,
  _email text default null,
  _code text default null,
  _account_type public.account_type default 'personal',
  _company_name text default null,
  _kkf_number text default null,
  _contact_person text default null,
  _address text default null,
  _district text default null
)
returns public.customers
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  _c public.customers;
begin
  if not (select public.is_staff()) then
    raise exception 'Geen toegang' using errcode = '42501';
  end if;

  _c.full_name := nullif(btrim(_full_name), '');
  _c.phone := nullif(btrim(_phone), '');
  if _c.full_name is null then
    raise exception 'Naam is verplicht' using errcode = '22023';
  end if;
  if _c.phone is null then
    raise exception 'Telefoonnummer is verplicht' using errcode = '22023';
  end if;
  _c.account_type := coalesce(_account_type, 'personal');
  _c.company_name := nullif(btrim(_company_name), '');
  if _c.account_type = 'business' and _c.company_name is null then
    raise exception 'Bedrijfsnaam is verplicht voor een zakelijke klant' using errcode = '22023';
  end if;
  _c.email := nullif(lower(btrim(_email)), '');
  if _c.email is not null and _c.email !~ '^[^@\s]+@[^@\s]+$' then
    raise exception 'Ongeldig e-mailadres' using errcode = '22023';
  end if;
  if nullif(btrim(_code), '') is not null then
    _c.customer_number := private.parse_customer_code(_code);
  end if;
  _c.kkf_number := nullif(btrim(_kkf_number), '');
  _c.contact_person := nullif(btrim(_contact_person), '');
  _c.address := nullif(btrim(_address), '');
  _c.district := nullif(btrim(_district), '');
  _c.status := 'active';
  return private.insert_customer(_c);
end
$$;

-- The only way customers change their own record (SPEC §35.5). A null
-- argument keeps the current value, an empty string clears it (not phone).
create or replace function public.update_my_contact(
  _phone text default null,
  _address text default null,
  _district text default null,
  _contact_person text default null
)
returns public.customers
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  _id uuid := (select public.current_customer_id());
  _row public.customers;
begin
  if _id is null then
    raise exception 'Geen toegang' using errcode = '42501';
  end if;
  if _phone is not null and btrim(_phone) = '' then
    raise exception 'Telefoonnummer is verplicht' using errcode = '22023';
  end if;
  update public.customers c set
    phone = coalesce(btrim(_phone), c.phone),
    address = case when _address is null then c.address else nullif(btrim(_address), '') end,
    district = case when _district is null then c.district else nullif(btrim(_district), '') end,
    contact_person = case when _contact_person is null then c.contact_person else nullif(btrim(_contact_person), '') end
  where c.id = _id
  returning * into _row;
  return _row;
end
$$;

-- Public contact and terms text for visitors who are not logged in (owner
-- decision: anon has no grant on company_settings itself).
create or replace function public.public_company_info()
returns table (
  company_name text,
  tagline text,
  email text,
  phone text,
  address text,
  pickup_address text,
  pickup_hours text,
  pickup_instructions text,
  terms_markdown text,
  terms_version text,
  prohibited_goods_markdown text,
  public_signup_enabled boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select s.company_name, s.tagline, s.email, s.phone, s.address, s.pickup_address,
         s.pickup_hours, s.pickup_instructions, s.terms_markdown, s.terms_version,
         s.prohibited_goods_markdown, s.public_signup_enabled
  from public.company_settings s
  where s.id
$$;

-- ===========================================================================
-- Service-role-only RPCs (server code after validating the invitation token).
-- Execute is granted to service_role alone; the role check is a second fence.
-- ===========================================================================

create or replace function public.admin_auth_user_by_email(_email text)
returns table (id uuid, email text, email_confirmed_at timestamptz, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'Geen toegang' using errcode = '42501';
  end if;
  return query
    select u.id, u.email::text, u.email_confirmed_at, u.created_at
    from auth.users u
    where lower(u.email) = lower(btrim(_email));
end
$$;

create or replace function public.get_invitation(_token_hash text)
returns table (
  invitation_id uuid,
  kind public.invitation_kind,
  email text,
  staff_role public.app_role,
  customer_id uuid,
  customer_code text,
  full_name text,
  expires_at timestamptz,
  accepted_at timestamptz,
  revoked_at timestamptz,
  is_expired boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'Geen toegang' using errcode = '42501';
  end if;
  return query
    select i.id, i.kind, i.email, i.staff_role, i.customer_id, c.customer_code, c.full_name,
           i.expires_at, i.accepted_at, i.revoked_at, i.expires_at <= now()
    from public.invitations i
    left join public.customers c on c.id = i.customer_id
    where i.token_hash = lower(btrim(_token_hash));
end
$$;

-- Links an invitation to an Auth user in one transaction, idempotently
-- (SPEC §35.6: the server function links it itself, never relying on the
-- sign-up trigger). Holding the token is proven by knowing its hash.
create or replace function public.redeem_invitation(_token_hash text, _user_id uuid)
returns table (invitation_id uuid, kind public.invitation_kind, customer_id uuid, staff_role public.app_role)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  _inv public.invitations;
  _user_email text;
  _cust public.customers;
  _linked_code text;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'Geen toegang' using errcode = '42501';
  end if;

  select * into _inv from public.invitations i where i.token_hash = lower(btrim(_token_hash)) for update;
  if not found then
    raise exception 'Uitnodiging niet gevonden' using errcode = 'P0002';
  end if;
  if _inv.accepted_at is not null then
    if _inv.accepted_by = _user_id then
      return query select _inv.id, _inv.kind, _inv.customer_id, _inv.staff_role;
      return;
    end if;
    raise exception 'Deze uitnodiging is al gebruikt' using errcode = '55000';
  end if;
  if _inv.revoked_at is not null then
    raise exception 'Deze uitnodiging is ingetrokken' using errcode = '55000';
  end if;
  if _inv.expires_at <= now() then
    raise exception 'Deze uitnodiging is verlopen' using errcode = '55000';
  end if;

  select lower(u.email) into _user_email from auth.users u where u.id = _user_id;
  if not found then
    raise exception 'Gebruiker niet gevonden' using errcode = 'P0002';
  end if;
  if _user_email is distinct from _inv.email then
    raise exception 'Het e-mailadres van dit account hoort niet bij deze uitnodiging' using errcode = '42501';
  end if;
  -- Second fence behind user_roles_revoke_invitations: the inviter must still
  -- hold the rights to create this invitation (a null inviter is the SQL editor).
  if _inv.created_by is not null and not (
       public.has_role(_inv.created_by, 'admin')
       or (_inv.kind = 'customer' and public.has_role(_inv.created_by, 'staff'))) then
    raise exception 'Deze uitnodiging is niet meer geldig; vraag een nieuwe uitnodiging aan' using errcode = '55000';
  end if;

  if _inv.kind = 'customer' then
    select * into _cust from public.customers c where c.id = _inv.customer_id for update;
    if _cust.user_id is not null and _cust.user_id <> _user_id then
      raise exception 'Dit klantdossier is al aan een ander account gekoppeld' using errcode = '55000';
    end if;
    if _cust.status = 'disabled' then
      raise exception 'Dit klantdossier is gedeactiveerd' using errcode = '55000';
    end if;
    -- Second fence behind customers_revoke_stale_invitations: the link only
    -- works for the address the customer record has now.
    if _cust.email is distinct from _inv.email then
      raise exception 'Het e-mailadres van dit klantdossier is gewijzigd; vraag een nieuwe uitnodiging aan'
        using errcode = '55000';
    end if;
    select c.customer_code into _linked_code
    from public.customers c where c.user_id = _user_id and c.id <> _cust.id;
    if found then
      raise exception 'Dit account is al gekoppeld aan klantdossier %', _linked_code using errcode = '55000';
    end if;
    update public.customers c
       set user_id = _user_id, status = 'active', updated_by = _user_id
     where c.id = _cust.id;
    update public.profiles p
       set display_name = _cust.full_name
     where p.id = _user_id and p.display_name is null;
  else
    insert into public.user_roles (user_id, role, created_by)
    values (_user_id, _inv.staff_role, _inv.created_by)
    on conflict (user_id, role) do nothing;
  end if;

  -- A self-registration with this e-mail may have raised a task; it is solved
  -- now. GoTrue can confirm the e-mail before it writes invitation_id (path b),
  -- so the sign-up trigger may have run without knowing about the invitation.
  update public.staff_tasks t
     set resolved_at = now(), resolved_by = _user_id
   where t.kind = 'signup_email_conflict'
     and t.resolved_at is null
     and (t.email = _inv.email or (_inv.kind = 'customer' and t.customer_id = _inv.customer_id));

  update public.invitations i
     set accepted_at = now(), accepted_by = _user_id, updated_by = _user_id
   where i.id = _inv.id;

  return query select _inv.id, _inv.kind, _inv.customer_id, _inv.staff_role;
end
$$;

-- ===========================================================================
-- Row level security: one policy per command, all to authenticated.
-- Reference data is readable only by staff and ACTIVE customers, so a
-- disabled customer (or a login without a customer record) sees nothing.
-- ===========================================================================

alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.customers enable row level security;
alter table public.invitations enable row level security;
alter table public.staff_tasks enable row level security;
alter table public.company_settings enable row level security;
alter table public.company_bank_accounts enable row level security;
alter table public.warehouse_addresses enable row level security;
alter table public.service_rates enable row level security;
alter table public.audit_log enable row level security;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (
    (select public.is_staff())
    or (id = (select auth.uid()) and (select public.current_customer_id()) is not null)
  );

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update to authenticated
  using (
    id = (select auth.uid())
    and ((select public.is_staff()) or (select public.current_customer_id()) is not null)
  )
  with check (id = (select auth.uid()));

drop policy if exists user_roles_select on public.user_roles;
create policy user_roles_select on public.user_roles
  for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));

drop policy if exists customers_select on public.customers;
create policy customers_select on public.customers
  for select to authenticated
  using (id = (select public.current_customer_id()) or (select public.is_staff()));

drop policy if exists customers_insert on public.customers;
create policy customers_insert on public.customers
  for insert to authenticated
  with check ((select public.is_staff()));

drop policy if exists customers_update on public.customers;
create policy customers_update on public.customers
  for update to authenticated
  using ((select public.is_staff()))
  with check ((select public.is_staff()));

drop policy if exists invitations_select on public.invitations;
create policy invitations_select on public.invitations
  for select to authenticated
  using ((select public.is_staff()));

drop policy if exists invitations_insert on public.invitations;
create policy invitations_insert on public.invitations
  for insert to authenticated
  with check ((select public.is_staff()) and (kind = 'customer' or (select public.is_admin())));

drop policy if exists invitations_update on public.invitations;
create policy invitations_update on public.invitations
  for update to authenticated
  using ((select public.is_staff()) and (kind = 'customer' or (select public.is_admin())))
  with check ((select public.is_staff()) and (kind = 'customer' or (select public.is_admin())));

drop policy if exists staff_tasks_select on public.staff_tasks;
create policy staff_tasks_select on public.staff_tasks
  for select to authenticated
  using ((select public.is_staff()));

drop policy if exists staff_tasks_insert on public.staff_tasks;
create policy staff_tasks_insert on public.staff_tasks
  for insert to authenticated
  with check ((select public.is_staff()));

drop policy if exists staff_tasks_update on public.staff_tasks;
create policy staff_tasks_update on public.staff_tasks
  for update to authenticated
  using ((select public.is_staff()))
  with check ((select public.is_staff()));

drop policy if exists staff_tasks_delete on public.staff_tasks;
create policy staff_tasks_delete on public.staff_tasks
  for delete to authenticated
  using ((select public.is_admin()));

drop policy if exists company_settings_select on public.company_settings;
create policy company_settings_select on public.company_settings
  for select to authenticated
  using ((select public.is_staff()) or (select public.current_customer_id()) is not null);

drop policy if exists company_settings_update on public.company_settings;
create policy company_settings_update on public.company_settings
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

drop policy if exists company_bank_accounts_select on public.company_bank_accounts;
create policy company_bank_accounts_select on public.company_bank_accounts
  for select to authenticated
  using (
    (select public.is_staff())
    or (is_active and (select public.current_customer_id()) is not null)
  );

drop policy if exists company_bank_accounts_insert on public.company_bank_accounts;
create policy company_bank_accounts_insert on public.company_bank_accounts
  for insert to authenticated
  with check ((select public.is_admin()));

drop policy if exists company_bank_accounts_update on public.company_bank_accounts;
create policy company_bank_accounts_update on public.company_bank_accounts
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

drop policy if exists warehouse_addresses_select on public.warehouse_addresses;
create policy warehouse_addresses_select on public.warehouse_addresses
  for select to authenticated
  using (
    (select public.is_staff())
    or (is_active and (select public.current_customer_id()) is not null)
  );

drop policy if exists warehouse_addresses_insert on public.warehouse_addresses;
create policy warehouse_addresses_insert on public.warehouse_addresses
  for insert to authenticated
  with check ((select public.is_admin()));

drop policy if exists warehouse_addresses_update on public.warehouse_addresses;
create policy warehouse_addresses_update on public.warehouse_addresses
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

drop policy if exists service_rates_select on public.service_rates;
create policy service_rates_select on public.service_rates
  for select to authenticated
  using (
    (select public.is_staff())
    or (enabled and (select public.current_customer_id()) is not null)
  );

drop policy if exists service_rates_insert on public.service_rates;
create policy service_rates_insert on public.service_rates
  for insert to authenticated
  with check ((select public.is_admin()));

drop policy if exists service_rates_update on public.service_rates;
create policy service_rates_update on public.service_rates
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

drop policy if exists audit_log_select on public.audit_log;
create policy audit_log_select on public.audit_log
  for select to authenticated
  using ((select public.is_admin()));

-- ===========================================================================
-- Grants. Supabase grants ALL on new public objects to the API roles, so take
-- everything back and grant only what the app and server code use.
-- ===========================================================================

revoke all on table
  public.profiles, public.user_roles, public.customers, public.invitations, public.staff_tasks,
  public.company_settings, public.company_bank_accounts, public.warehouse_addresses,
  public.service_rates, public.audit_log
from anon, authenticated, service_role;

grant select on public.profiles to authenticated;
grant update (display_name) on public.profiles to authenticated;
grant select on public.user_roles to authenticated;
grant select, insert, update on public.customers to authenticated;
grant select, insert, update on public.invitations to authenticated;
grant select, insert, update, delete on public.staff_tasks to authenticated;
grant select, update on public.company_settings to authenticated;
grant select, insert, update on public.company_bank_accounts to authenticated;
grant select, insert, update on public.warehouse_addresses to authenticated;
grant select, insert, update on public.service_rates to authenticated;
grant select on public.audit_log to authenticated;

-- Server code: invitation lookups/redemption, ban bookkeeping, reminder jobs.
grant select, insert, update on public.profiles to service_role;
grant select on public.user_roles to service_role;
grant select, insert, update on public.customers to service_role;
grant select, update on public.invitations to service_role;
grant select, insert, update on public.staff_tasks to service_role;
grant select on public.company_settings to service_role;
grant select on public.company_bank_accounts to service_role;
grant select on public.warehouse_addresses to service_role;
grant select on public.service_rates to service_role;
grant select on public.audit_log to service_role;

revoke all on all sequences in schema public from anon, authenticated;

-- Functions: nobody by default, then exactly who needs each one.
revoke all on function
  public.has_role(uuid, public.app_role),
  public.is_admin(),
  public.is_staff(),
  public.current_customer_id(),
  public.set_user_role(uuid, public.app_role, boolean),
  public.peek_next_customer_number(),
  public.set_next_customer_number(integer),
  public.change_customer_code(uuid, text, text),
  public.create_customer(text, text, text, text, public.account_type, text, text, text, text, text),
  public.update_my_contact(text, text, text, text),
  public.public_company_info(),
  public.admin_auth_user_by_email(text),
  public.get_invitation(text),
  public.redeem_invitation(text, uuid)
from public, anon, authenticated, service_role;

grant execute on function
  public.has_role(uuid, public.app_role),
  public.is_admin(),
  public.is_staff(),
  public.current_customer_id(),
  public.set_user_role(uuid, public.app_role, boolean),
  public.peek_next_customer_number(),
  public.set_next_customer_number(integer),
  public.change_customer_code(uuid, text, text),
  public.create_customer(text, text, text, text, public.account_type, text, text, text, text, text),
  public.update_my_contact(text, text, text, text)
to authenticated;

grant execute on function public.public_company_info() to anon, authenticated, service_role;

grant execute on function
  public.admin_auth_user_by_email(text),
  public.get_invitation(text),
  public.redeem_invitation(text, uuid)
to service_role;

revoke all on function
  private.parse_customer_code(text),
  private.customer_number_available(integer),
  private.next_customer_number(),
  private.customer_has_activity(uuid),
  private.insert_customer(public.customers),
  private.touch_updated_at(),
  private.audit_row(),
  private.customers_guard(),
  private.customers_set_code(),
  private.customers_retire_number(),
  private.customers_revoke_stale_invitations(),
  private.user_roles_revoke_invitations(),
  private.invitations_guard(),
  private.invitations_sync_customer(),
  private.staff_tasks_stamp(),
  private.handle_new_user(),
  private.add_staff_task(public.staff_task_kind, uuid, text, uuid, text)
from public, anon, authenticated, service_role;
