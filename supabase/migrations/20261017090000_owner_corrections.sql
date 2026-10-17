-- Owner corrections after the first look at the app (docs/SPEC.md §36).
--
-- 1. Customer codes without leading zeros: GR + the customer number (GR67,
--    GR100, GR1234) instead of GR + five digits (GR00067). The number stays
--    the same, only the way it is written changes; codes typed with zeros
--    ("GR00067") still mean 67 (parse_customer_code). Numbers keep their
--    range 1–99999. The messages that print a code follow the new form.
-- 2. The company phone number is +597 7589695: the seeded 5978897500 is
--    replaced (a number the owner already changed in the settings stays).
-- 3. Sea freight is offered: customers choose Air or Ocean per order.
-- 4. US address: the customer writes the code and the service in front of
--    their name ("GR67 Air Naam", "GR67 Ocean Naam") and no code on address
--    line 2. New defaults, and addresses that still have the old defaults get
--    the new ones; a template the owner wrote differently stays.
--    {SERVICE} is filled in by the portal with Air or Ocean.
--
-- Idempotent. The generated types do not change (no new columns or RPCs).

-- ===========================================================================
-- 1. Customer codes without leading zeros
-- ===========================================================================

alter table public.customers
  alter column customer_code set expression as ('GR' || customer_number::text);

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
    raise exception 'Ongeldige klantcode "%": gebruik GR gevolgd door een nummer van 1 t/m 99999, bijvoorbeeld GR67', coalesce(_input, '')
      using errcode = '22023';
  end if;
  return _digits::integer;
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
      raise exception 'Een klantcode is GR gevolgd door een nummer van 1 t/m 99999 (GR1 t/m GR99999)' using errcode = '22023';
    end if;
    select c.full_name into _other
    from public.customers c
    where c.customer_number = new.customer_number and c.id <> new.id;
    if found then
      raise exception '% is al toegewezen aan %', 'GR' || new.customer_number::text, _other.full_name
        using errcode = '23505', constraint = 'customers_customer_number_key';
    end if;
    -- Only the customer who gave a number up may take it back (an undone
    -- code change); packages may still be labelled with it.
    if exists (
      select 1 from private.retired_customer_numbers r
      where r.customer_number = new.customer_number and r.customer_id is distinct from new.id
    ) then
      raise exception '% is eerder gebruikt en wordt niet opnieuw uitgegeven', 'GR' || new.customer_number::text
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
      _max using errcode = '22023';
  end if;
  select s.last_value, s.is_called into _last, _called from private.customer_number_seq s;
  if _called and _next <= _last then
    raise exception 'GR% is al eens uitgegeven; kies een nummer hoger dan GR%',
      _next, _last using errcode = '22023';
  end if;
  select max(r.customer_number) into _retired from private.retired_customer_numbers r;
  if _next <= _retired then
    raise exception 'GR% is eerder gebruikt en wordt niet opnieuw uitgegeven; kies een nummer hoger dan dat',
      _retired using errcode = '22023';
  end if;

  perform setval('private.customer_number_seq', _next, false);
  insert into public.audit_log (actor_id, table_name, record_id, action, old_data, new_data, changed_columns)
  values ((select auth.uid()), 'customer_number_seq', 'next', 'UPDATE',
          jsonb_build_object('next', case when _called then _last + 1 else _last end),
          jsonb_build_object('next', _next), array['next']);
  return _next;
end
$$;

-- ===========================================================================
-- 2. Company phone number
-- ===========================================================================

update public.company_settings
   set phone = '+597 7589695'
 where id and regexp_replace(coalesce(phone, ''), '\D', '', 'g') = '5978897500';

-- ===========================================================================
-- 3. Sea freight (Ocean) next to air freight
-- ===========================================================================

update public.service_rates set enabled = true where service_type = 'sea' and not enabled;

-- ===========================================================================
-- 4. US address: "GR67 Air Naam" / "GR67 Ocean Naam", nothing on line 2
-- ===========================================================================

alter table public.warehouse_addresses
  alter column recipient_name_template set default '{GR_CODE} {SERVICE} {FULL_NAME}',
  alter column address_line2_template set default '';

update public.warehouse_addresses
   set recipient_name_template = '{GR_CODE} {SERVICE} {FULL_NAME}'
 where recipient_name_template = '{FULL_NAME} {GR_CODE}';

update public.warehouse_addresses
   set address_line2_template = ''
 where address_line2_template = '{GR_CODE}';
