-- pg_cron as a Supabase project has it after `create extension pg_cron`
-- (Supabase docs: `with schema pg_catalog`; the objects live in schema cron).
-- Loaded by harness.ts in place of that statement. Test-only.
--
-- Behavioural stub: jobs are recorded, never run. pg_cron interprets
-- schedules in UTC (America/Paramaribo is UTC-3).
--
-- Rights as Supabase's grant_pg_cron_access hook leaves them: postgres has
-- USAGE on cron and may READ cron.job, but not write it; jobs change only
-- through cron.schedule / cron.unschedule. PGlite's postgres is a superuser,
-- so a statement trigger enforces that instead of the missing privileges.

create schema cron;
revoke all on schema cron from public;
grant usage on schema cron to postgres;

create table cron.job (
  jobid bigserial primary key,
  schedule text not null,
  command text not null,
  nodename text not null default 'localhost',
  nodeport integer not null default 5432,
  database text not null default current_database(),
  username text not null default current_user,
  active boolean not null default true,
  jobname text
);
create unique index jobname_username_uniq on cron.job (jobname, username);

create table cron.job_run_details (
  jobid bigint,
  runid bigserial primary key,
  job_pid integer,
  database text,
  username text,
  command text,
  status text,
  return_message text,
  start_time timestamptz,
  end_time timestamptz
);

revoke all on cron.job, cron.job_run_details from public;
grant select on cron.job to postgres;
grant all on cron.job_run_details to postgres;

create function cron.__guard_job_write() returns trigger language plpgsql as $$
begin
  if coalesce(current_setting('supabase_stub.cron_internal', true), '') <> 'on' then
    raise exception 'permission denied for table job'
      using errcode = '42501', hint = 'Use cron.schedule() / cron.unschedule().';
  end if;
  return null;
end
$$;

create trigger job_write_guard before insert or update or delete or truncate on cron.job
  for each statement execute function cron.__guard_job_write();

create function cron.__check_schedule(schedule text) returns void language plpgsql as $$
begin
  if schedule is null
     or not (
       schedule ~ '^\s*\S+(\s+\S+){4}\s*$'
       or schedule ~ '^\s*([1-9]|[1-5][0-9])\s+seconds?\s*$'
       or schedule ~ '^\s*@(yearly|annually|monthly|weekly|daily|hourly|reboot)\s*$'
     ) then
    raise exception 'invalid schedule: %', schedule;
  end if;
end
$$;

create function cron.schedule(job_name text, schedule text, command text) returns bigint
language plpgsql as $$
declare
  _jobid bigint;
begin
  perform cron.__check_schedule(schedule);
  perform set_config('supabase_stub.cron_internal', 'on', true);
  update cron.job j set schedule = $2, command = $3, active = true
   where j.jobname = job_name and j.username = current_user
  returning j.jobid into _jobid;
  if _jobid is null then
    insert into cron.job (schedule, command, jobname) values ($2, $3, job_name)
    returning jobid into _jobid;
  end if;
  perform set_config('supabase_stub.cron_internal', '', true);
  return _jobid;
end
$$;

create function cron.schedule(schedule text, command text) returns bigint
language plpgsql as $$
declare
  _jobid bigint;
begin
  perform cron.__check_schedule(schedule);
  perform set_config('supabase_stub.cron_internal', 'on', true);
  insert into cron.job (schedule, command) values ($1, $2) returning jobid into _jobid;
  perform set_config('supabase_stub.cron_internal', '', true);
  return _jobid;
end
$$;

-- Like the real extension, unscheduling an unknown job raises, so idempotent
-- migrations must check cron.job first.
create function cron.unschedule(job_name text) returns boolean language plpgsql as $$
begin
  perform set_config('supabase_stub.cron_internal', 'on', true);
  delete from cron.job j where j.jobname = job_name and j.username = current_user;
  if not found then
    raise exception 'could not find valid entry for job ''%''', job_name;
  end if;
  perform set_config('supabase_stub.cron_internal', '', true);
  return true;
end
$$;

create function cron.unschedule(job_id bigint) returns boolean language plpgsql as $$
begin
  perform set_config('supabase_stub.cron_internal', 'on', true);
  delete from cron.job j where j.jobid = job_id;
  if not found then
    raise exception 'could not find valid entry for job %', job_id;
  end if;
  perform set_config('supabase_stub.cron_internal', '', true);
  return true;
end
$$;

revoke all on all functions in schema cron from public;
grant execute on function
  cron.schedule(text, text, text),
  cron.schedule(text, text),
  cron.unschedule(text),
  cron.unschedule(bigint)
to postgres;
