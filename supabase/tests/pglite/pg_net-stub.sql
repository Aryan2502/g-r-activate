-- pg_net as a Supabase project has it after `create extension pg_net`
-- (the objects always live in schema net). Loaded by harness.ts in place of
-- that statement. Test-only.
--
-- Behavioural stub: requests are queued in net.http_request_queue and never
-- sent, so tests can assert on what would have been posted. The queue has the
-- real shape: method is net.http_method, headers are required, the body is
-- bytea (decode with convert_from(body, 'UTF8')), and there is no timestamp.
--
-- Rights as Supabase's grant_pg_net_access hook leaves them: USAGE on net and
-- EXECUTE on the request functions for postgres AND anon, authenticated and
-- service_role. A migration that must keep clients from making the database
-- send HTTP requests has to revoke that itself.

create schema net;
revoke all on schema net from public;
grant usage on schema net to postgres, anon, authenticated, service_role;

create type net.http_method as enum ('GET', 'POST', 'DELETE');

create table net.http_request_queue (
  id bigserial,
  method net.http_method not null,
  url text not null,
  headers jsonb not null,
  body bytea,
  timeout_milliseconds integer not null
);

create table net._http_response (
  id bigint,
  status_code integer,
  content_type text,
  headers jsonb,
  content text,
  timed_out boolean,
  error_msg text,
  created timestamptz not null default now()
);

revoke all on net.http_request_queue, net._http_response from public;
grant select on net.http_request_queue, net._http_response to postgres;

create function net.__url_with_params(url text, params jsonb) returns text
language sql immutable as $$
  select url || coalesce(
    (select case when strpos(url, '?') > 0 then '&' else '?' end
            || string_agg(format('%s=%s', p.key, p.value), '&' order by p.key)
       from jsonb_each_text(coalesce(params, '{}'::jsonb)) p),
    '')
$$;

create function net.http_get(
  url text,
  params jsonb default '{}'::jsonb,
  headers jsonb default '{}'::jsonb,
  timeout_milliseconds integer default 5000
) returns bigint language sql security definer set search_path = '' as $$
  insert into net.http_request_queue (method, url, headers, body, timeout_milliseconds)
  values ('GET', net.__url_with_params(url, params), coalesce(headers, '{}'::jsonb), null, timeout_milliseconds)
  returning id
$$;

-- Like the real function: the body is sent as JSON, so the Content-Type
-- header defaults to (and must be) application/json.
create function net.http_post(
  url text,
  body jsonb default '{}'::jsonb,
  params jsonb default '{}'::jsonb,
  headers jsonb default '{"Content-Type": "application/json"}'::jsonb,
  timeout_milliseconds integer default 5000
) returns bigint language plpgsql security definer set search_path = '' as $$
declare
  _headers jsonb := coalesce(headers, '{}'::jsonb);
  _type text;
  _id bigint;
begin
  select h.value into _type from jsonb_each_text(_headers) h where lower(h.key) = 'content-type' limit 1;
  if _type is null then
    _headers := _headers || '{"Content-Type": "application/json"}'::jsonb;
  elsif _type not ilike 'application/json%' then
    raise exception 'Content-Type header must be "application/json"';
  end if;
  insert into net.http_request_queue (method, url, headers, body, timeout_milliseconds)
  values ('POST', net.__url_with_params(url, params), _headers, convert_to(body::text, 'UTF8'), timeout_milliseconds)
  returning id into _id;
  return _id;
end
$$;

create function net.http_delete(
  url text,
  params jsonb default '{}'::jsonb,
  headers jsonb default '{}'::jsonb,
  timeout_milliseconds integer default 5000
) returns bigint language sql security definer set search_path = '' as $$
  insert into net.http_request_queue (method, url, headers, body, timeout_milliseconds)
  values ('DELETE', net.__url_with_params(url, params), coalesce(headers, '{}'::jsonb), null, timeout_milliseconds)
  returning id
$$;

revoke all on all functions in schema net from public;
grant execute on function
  net.http_get(text, jsonb, jsonb, integer),
  net.http_post(text, jsonb, jsonb, jsonb, integer),
  net.http_delete(text, jsonb, jsonb, integer)
to postgres, anon, authenticated, service_role;
grant execute on function net.__url_with_params(text, jsonb) to postgres;
