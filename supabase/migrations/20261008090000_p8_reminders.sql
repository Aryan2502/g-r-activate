-- P8 (SPEC §35.12): the daily payment-reminder schedule, plus the lookup the
-- same job uses to clean up uploads that never got an order_documents row.
--
-- * pg_cron + pg_net. Every day at 12:00 UTC (09:00 in Suriname, UTC-3 all
--   year) pg_cron runs private.invoke_payment_reminders(), which POSTs to
--   <app_url>/api/cron/payment-reminders with "Authorization: Bearer
--   <cron_secret>". Both values live in Supabase Vault (secrets 'app_url' and
--   'cron_secret', created by the owner: docs/DEPLOYMENT.md §7). Without them
--   the function quietly does nothing. No secret or URL is in this file.
-- * The database never e-mails (SPEC §35.12): it only wakes the endpoint,
--   which checks CRON_SECRET and runs runPaymentReminders() in server code.
-- * pg_net and the API roles: on Supabase pg_net is a supautils "privileged
--   extension", created by supabase_admin, which therefore OWNS schema net
--   and its functions. pg_net >= 0.12 leaves EXECUTE on its functions to
--   PUBLIC and grants USAGE on net to PUBLIC; Supabase's grant_pg_net_access
--   hook adds USAGE for anon and authenticated. The role that runs this file
--   (postgres, not a superuser, not the owner, no grant option) cannot revoke
--   any of that: a REVOKE here would only print "no privileges could be
--   revoked" on every push. So this file does not try. What keeps clients
--   from making the database send HTTP requests is that `net` is NOT an
--   exposed schema of the Data API (PostgREST serves public and
--   graphql_public only): no client request can name net.http_post, and no
--   function a client may call reaches pg_net (private.invoke_payment_reminders
--   is revoked from every API role below). docs/DEPLOYMENT.md §2.1 and §7.4:
--   keep `net` and `extensions` out of Settings → Data API → Exposed schemas.
-- * public.orphan_order_document_objects(): service_role only. The cron
--   endpoint lists storage objects in 'order-documents' that are older than
--   24 hours and have no order_documents row, and removes them through the
--   Storage API (never with SQL: Supabase refuses direct deletes there).
--
-- Idempotent: running this file again keeps exactly one scheduled job.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- ===========================================================================
-- The scheduled call
-- ===========================================================================

-- Runs as the job's owner (postgres) from pg_cron. Reads the two Vault
-- secrets and queues one POST; the response is not awaited (pg_net is
-- asynchronous) and the endpoint records the run in public.job_runs.
create or replace function private.invoke_payment_reminders()
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  _app_url text;
  _secret text;
begin
  select nullif(btrim(s.decrypted_secret), '') into _app_url
    from vault.decrypted_secrets s where s.name = 'app_url';
  select nullif(btrim(s.decrypted_secret), '') into _secret
    from vault.decrypted_secrets s where s.name = 'cron_secret';
  if _app_url is null or _secret is null then
    return null;  -- not set up yet (docs/DEPLOYMENT.md §7)
  end if;

  _app_url := regexp_replace(_app_url, '/+$', '');
  if _app_url !~ '^https://[^/?#@[:space:]]+$'
     and _app_url !~ '^http://(localhost|127\.0\.0\.1)(:[0-9]+)?$' then
    raise warning 'Vault secret app_url must be an origin such as https://portal.example.com; payment reminders not started';
    return null;
  end if;

  return net.http_post(
    url := _app_url || '/api/cron/payment-reminders',
    body := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || _secret
    ),
    timeout_milliseconds := 60000
  );
end
$$;

revoke all on function private.invoke_payment_reminders()
from public, anon, authenticated, service_role;

-- One job, named; cron.schedule with a name updates an existing job of that
-- name. Copies of the same call under another name (e.g. made by hand in the
-- dashboard) would run the reminders twice a day, so they are removed.
do $$
declare
  _job record;
begin
  for _job in
    select j.jobid
      from cron.job j
     where j.command like '%private.invoke_payment_reminders%'
       and j.jobname is distinct from 'gr-payment-reminders'
       and j.username = current_user
  loop
    perform cron.unschedule(_job.jobid);
  end loop;
  perform cron.schedule(
    'gr-payment-reminders',
    '0 12 * * *',
    'select private.invoke_payment_reminders()'
  );
end
$$;

-- ===========================================================================
-- Orphaned uploads (PROGRESS carry-over)
-- ===========================================================================

-- The browser uploads to Storage first and records the file in
-- order_documents afterwards; an upload whose record was never written (tab
-- closed, network gone) stays behind. Only objects older than 24 hours count,
-- whatever the caller asks, so an upload in progress is never touched.
create or replace function public.orphan_order_document_objects(
  _min_age_hours integer default 24,
  _limit integer default 500
)
returns table (name text, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'Geen toegang' using errcode = '42501';
  end if;
  return query
    select o.name, o.created_at
      from storage.objects o
     where o.bucket_id = 'order-documents'
       and o.name is not null
       and o.created_at < now() - make_interval(hours => greatest(coalesce(_min_age_hours, 24), 24))
       and not exists (select 1 from public.order_documents d where d.storage_path = o.name)
     order by o.created_at
     limit least(greatest(coalesce(_limit, 500), 1), 1000);
end
$$;

revoke all on function public.orphan_order_document_objects(integer, integer)
from public, anon, authenticated, service_role;
grant execute on function public.orphan_order_document_objects(integer, integer) to service_role;
