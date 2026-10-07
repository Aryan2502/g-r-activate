-- Guards found in the P4 review (docs/PROGRESS.md, "Bewijs P4 reviewronde").
-- 1. Hand-over is per customer: a completed status ("Afgehaald", "Bezorgd")
--    records ONE collector name, so all orders that move in one action must
--    belong to one customer. Before this, a bulk or whole-shipment hand-over
--    stamped one customer's collector on other customers' orders, and every
--    customer read that name in the portal.
-- 2. "Toch afgeven" (pickup_override) audits only the orders that are really
--    unpaid, decided here and not by the browser's (possibly stale) list. The
--    other orders of the selection are handed over normally, in the same
--    transaction.
-- 3. A new message while an order already waits in an action_required status
--    ("Upload ook de paklijst") becomes a history row the customer reads,
--    instead of being dropped as "already in this status".
-- 4. An order travels with a shipment of its own service type: changing an
--    order's service type while it is in a shipment, putting it into a
--    shipment of another service type, or changing the service type of a
--    shipment that holds orders is refused (also for customers, who may still
--    edit a registered order that staff already put in a shipment).

-- ===========================================================================
-- Helpers
-- ===========================================================================

-- Refuses a hand-over whose moving orders belong to more than one customer.
-- Orders already in the target status are left alone, so they do not count.
create or replace function private.assert_one_customer_handover(_order_ids uuid[], _to_status text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (
    select count(distinct o.customer_id)
    from public.orders o
    where o.id = any (_order_ids) and o.status is distinct from _to_status
  ) > 1 then
    raise exception 'Afgeven gaat per klant: deze orders zijn van meer dan één klant. Geef ze per klant af, met de naam van wie het pakket meeneemt.'
      using errcode = '22023', hint = 'handover_one_customer';
  end if;
end
$$;

-- The orders of the selection that sit on an issued invoice with a balance
-- (what assert_paid_before_pickup refuses), ignoring orders already there.
create or replace function private.orders_with_open_balance(_order_ids uuid[], _to_status text)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct o.id), '{}')
  from public.orders o
  join public.invoice_items li on li.order_id = o.id
  join public.invoices i on i.id = li.invoice_id
  where o.id = any (_order_ids)
    and o.status is distinct from _to_status
    and i.status in ('open', 'partially_paid')
    and i.total_amount > private.invoice_amount_paid(i.id)
$$;

-- ===========================================================================
-- apply_order_status: migration 2's version plus the per-customer hand-over
-- guard (1) and the repeated "Actie vereist" message (3).
-- ===========================================================================

create or replace function private.apply_order_status(
  _order_ids uuid[],
  _to_status text,
  _customer_message text,
  _picked_up_by_name text
)
returns table (o_order_id uuid, o_history_id bigint, o_customer_id uuid, o_notify boolean)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  _uid uuid := (select auth.uid());
  _msg text := nullif(btrim(_customer_message), '');
  _name text := nullif(btrim(_picked_up_by_name), '');
  _ids uuid[];
  _st public.shipment_statuses;
  _locked integer;
  _changed uuid[] := '{}';
  _r record;
begin
  if _order_ids is null or cardinality(_order_ids) = 0 then
    raise exception 'Kies minstens één order' using errcode = '22023';
  end if;
  if array_position(_order_ids, null) is not null then
    raise exception 'Ongeldige order in de selectie' using errcode = '22023';
  end if;
  select array_agg(distinct x order by x) into _ids from unnest(_order_ids) x;
  if cardinality(_ids) > 1000 then
    raise exception 'Wijzig maximaal 1000 orders tegelijk' using errcode = '22023';
  end if;

  select * into _st from public.shipment_statuses s where s.code = _to_status;
  if not found then
    raise exception 'Onbekende status "%"', coalesce(_to_status, '') using errcode = '22023';
  end if;
  if not _st.active then
    raise exception 'Status "%" is niet actief', _st.label_nl using errcode = '22023';
  end if;
  if char_length(_msg) > 2000 then
    raise exception 'Het bericht voor de klant is te lang (maximaal 2000 tekens)' using errcode = '22023';
  end if;
  if _st.stage = 'action_required' and _msg is null then
    raise exception 'Schrijf de klant welke actie of documenten nodig zijn' using errcode = '22023';
  end if;
  if _st.stage = 'completed' and _name is null then
    raise exception 'Vul in wie het pakket heeft afgehaald of ontvangen' using errcode = '22023';
  end if;
  if _st.stage <> 'completed' and _name is not null then
    raise exception 'Een ophaler hoort alleen bij een afgeronde status' using errcode = '22023';
  end if;
  if char_length(_name) > 200 then
    raise exception 'De naam van de ophaler is te lang' using errcode = '22023';
  end if;

  -- A fixed lock order keeps two concurrent bulk changes from deadlocking.
  select count(*) into _locked
  from (select 1 from public.orders o where o.id = any (_ids) order by o.id for update) l;
  if _locked < cardinality(_ids) then
    raise exception 'Order niet gevonden' using errcode = 'P0002';
  end if;

  -- One collector name belongs to one customer's packages.
  if _st.stage = 'completed' then
    perform private.assert_one_customer_handover(_ids, _st.code);
  end if;

  perform set_config('app.status_message', coalesce(_msg, ''), true);
  perform set_config('app.order_internal_write', 'on', true);
  for _r in
    select o.id, o.customer_id, o.status from public.orders o where o.id = any (_ids) order by o.id
  loop
    o_order_id := _r.id;
    o_customer_id := _r.customer_id;
    o_history_id := null;
    o_notify := false;
    if _r.status is distinct from _st.code then
      -- Leaving a completed stage (a correction) clears the pickup record;
      -- the audit log keeps the old values.
      update public.orders o set
        status = _st.code,
        picked_up_at = case when _st.stage = 'completed' then now() end,
        picked_up_by_name = case when _st.stage = 'completed' then _name end,
        handed_over_by = case when _st.stage = 'completed' then _uid end
      where o.id = _r.id;
      select max(h.id) into o_history_id from public.shipment_status_history h where h.order_id = _r.id;
      o_notify := _st.notify_customer and _st.customer_visible;
      _changed := _changed || _r.id;
    elsif _st.stage = 'action_required'
      and _msg is distinct from (
        select h.customer_message
        from public.shipment_status_history h
        where h.order_id = _r.id and h.to_status = _st.code
        order by h.id desc
        limit 1
      ) then
      -- Already waiting for an action, with a new request: the customer reads
      -- the newest message on the order page (SPEC §35.7). The status stays.
      insert into public.shipment_status_history
        (order_id, from_status, to_status, changed_by, changed_at, customer_message)
      values (_r.id, _r.status, _st.code, _uid, now(), _msg)
      returning id into o_history_id;
      o_notify := _st.notify_customer and _st.customer_visible;
    end if;
    return next;
  end loop;
  perform set_config('app.order_internal_write', '', true);
  perform set_config('app.status_message', '', true);

  if _st.stage = 'cancelled' and cardinality(_changed) > 0 then
    update public.staff_tasks t
       set resolved_at = now(), resolved_by = _uid
     where t.kind = 'order_cancellation_request' and t.order_id = any (_changed) and t.resolved_at is null;
  end if;
end
$$;

-- ===========================================================================
-- pickup_override: the reason lands only on the orders that are unpaid.
-- ===========================================================================

create or replace function public.pickup_override(
  _order_ids uuid[],
  _to_status text,
  _picked_up_by_name text,
  _reason text,
  _customer_message text default null
)
returns table (order_id uuid, history_id bigint, customer_id uuid, notify boolean)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  _why text := left(nullif(btrim(_reason), ''), 500);
  _ids uuid[];
  _unpaid uuid[];
  _paid uuid[];
begin
  if not (select public.is_staff()) then
    raise exception 'Geen toegang' using errcode = '42501';
  end if;
  if _why is null then
    raise exception 'Een reden is verplicht' using errcode = '22023';
  end if;
  if not exists (select 1 from public.shipment_statuses s where s.code = _to_status and s.stage = 'completed') then
    raise exception 'Toch afgeven kan alleen naar een afgeronde status (afgehaald of bezorgd)' using errcode = '22023';
  end if;
  if _order_ids is null or cardinality(_order_ids) = 0 then
    raise exception 'Kies minstens één order' using errcode = '22023';
  end if;
  if array_position(_order_ids, null) is not null then
    raise exception 'Ongeldige order in de selectie' using errcode = '22023';
  end if;
  select array_agg(distinct x order by x) into _ids from unnest(_order_ids) x;

  -- Lock the whole selection first (same order as apply_order_status), so
  -- the per-customer check and the unpaid split see one state.
  perform 1 from public.orders o where o.id = any (_ids) order by o.id for update;
  perform private.assert_one_customer_handover(_ids, _to_status);

  _unpaid := private.orders_with_open_balance(_ids, _to_status);
  select coalesce(array_agg(x order by x), '{}') into _paid
  from unnest(_ids) x
  where not (x = any (_unpaid));

  if cardinality(_paid) > 0 then
    return query
      select a.o_order_id, a.o_history_id, a.o_customer_id, a.o_notify
      from private.apply_order_status(_paid, _to_status, _customer_message, _picked_up_by_name) a;
  end if;
  if cardinality(_unpaid) > 0 then
    perform set_config('app.audit_reason', 'Afgegeven zonder volledige betaling: ' || _why, true);
    return query
      select a.o_order_id, a.o_history_id, a.o_customer_id, a.o_notify
      from private.apply_order_status(_unpaid, _to_status, _customer_message, _picked_up_by_name) a;
    perform set_config('app.audit_reason', '', true);
  end if;
end
$$;

-- ===========================================================================
-- Shipment and service type (4)
-- ===========================================================================

create or replace function private.orders_shipment_service_type()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  _ship record;
begin
  if new.shipment_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and new.shipment_id is not distinct from old.shipment_id
     and new.service_type is not distinct from old.service_type then
    return new;
  end if;
  select s.shipment_number, s.service_type into _ship
  from public.shipments s where s.id = new.shipment_id;
  if not found or _ship.service_type = new.service_type then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.shipment_id is not distinct from old.shipment_id then
    if (select public.is_staff()) then
      raise exception 'Order % zit in zending %. Haal de order eerst uit de zending om de verzendwijze te wijzigen.', new.reference, _ship.shipment_number
        using errcode = '55000';
    end if;
    raise exception 'Deze order zit al in een zending van G&R Solutions; de verzendwijze kan niet meer worden gewijzigd. Neem contact op met G&R Solutions.'
      using errcode = '55000';
  end if;
  raise exception 'Order % heeft een andere verzendwijze dan zending %', new.reference, _ship.shipment_number
    using errcode = '22023';
end
$$;

drop trigger if exists orders_shipment_service_type on public.orders;
create trigger orders_shipment_service_type
  before insert or update of service_type, shipment_id
  on public.orders
  for each row execute function private.orders_shipment_service_type();

create or replace function private.shipments_service_type_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.service_type is distinct from old.service_type
     and exists (select 1 from public.orders o where o.shipment_id = new.id) then
    raise exception 'Zending % bevat orders; de verzendwijze kan niet meer worden gewijzigd', old.shipment_number
      using errcode = '55000';
  end if;
  return new;
end
$$;

drop trigger if exists shipments_service_type_guard on public.shipments;
create trigger shipments_service_type_guard
  before update of service_type
  on public.shipments
  for each row execute function private.shipments_service_type_guard();

-- ===========================================================================
-- Grants: replaced functions keep theirs; the new ones are closed.
-- ===========================================================================

revoke all on function
  private.assert_one_customer_handover(uuid[], text),
  private.orders_with_open_balance(uuid[], text),
  private.orders_shipment_service_type(),
  private.shipments_service_type_guard()
from public, anon, authenticated, service_role;
