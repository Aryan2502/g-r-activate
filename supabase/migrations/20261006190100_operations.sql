-- Migration 2 of P2a (SPEC §35.3): operations.
--
-- Shipment statuses, orders, consolidation shipments, the status history,
-- order documents (table + storage bucket and policies) and staff-only
-- internal notes. Billing and messaging follow in migration 3.
--
-- Same conventions as migration 1. Additions here:
-- * Column-level grants on orders, shipments, statuses, documents and notes:
--   status, reference, receiving, pickup and authorship columns are not
--   writable by any client, not even staff. They change only through the
--   SECURITY DEFINER RPCs below, which pass the update guard with the
--   transaction-local flag app.order_internal_write.
-- * Status changes (change_order_status, receive_order) write
--   shipment_status_history through one AFTER UPDATE OF status trigger; the
--   staff message travels in app.status_message.

-- ===========================================================================
-- Types
-- ===========================================================================

do $$
begin
  if to_regtype('public.status_stage') is null then
    -- Dashboards, the timeline and e-mails use the stage, never the labels.
    create type public.status_stage as enum (
      'registered', 'us_warehouse', 'in_transit', 'arrived_sr', 'at_customs',
      'cleared', 'ready_for_pickup', 'completed', 'cancelled', 'action_required'
    );
  end if;
  if to_regtype('public.order_type') is null then
    create type public.order_type as enum ('personal', 'b2b');
  end if;
  if to_regtype('public.order_creator_role') is null then
    create type public.order_creator_role as enum ('customer', 'staff');
  end if;
  if to_regtype('public.purchase_mode') is null then
    -- [owner to confirm] customer bought the goods / G&R buys on their behalf.
    create type public.purchase_mode as enum ('customer_purchased', 'gr_purchases');
  end if;
  if to_regtype('public.order_document_kind') is null then
    create type public.order_document_kind as enum (
      'purchase_invoice', 'commercial_invoice', 'packing_list', 'customs_document', 'other'
    );
  end if;
end
$$;

-- ===========================================================================
-- Tables
-- ===========================================================================

create table if not exists public.shipment_statuses (
  code text primary key,
  label_nl text not null,
  customer_description_nl text,
  stage public.status_stage not null,
  sort_order integer not null default 0,
  is_terminal boolean not null default false,
  customer_visible boolean not null default true,
  notify_customer boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  constraint shipment_statuses_code_format check (code ~ '^[a-z][a-z0-9_]{1,49}$'),
  constraint shipment_statuses_label_check check (btrim(label_nl) <> '' and char_length(label_nl) <= 100),
  constraint shipment_statuses_description_length check (char_length(customer_description_nl) <= 500),
  constraint shipment_statuses_sort_order_check check (sort_order between 0 and 100000)
);

create index if not exists shipment_statuses_stage_idx on public.shipment_statuses (stage, sort_order);
create index if not exists shipment_statuses_customer_visible_idx on public.shipment_statuses (customer_visible);

-- One flight or container; staff-only batches (SPEC §35.7).
create table if not exists public.shipments (
  id uuid primary key default gen_random_uuid(),
  shipment_number text not null,
  service_type public.service_type not null default 'air',
  carrier text,
  awb_or_container_number text,
  departed_at timestamptz,
  arrived_at timestamptz,
  customer_note text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  constraint shipments_number_check
    check (shipment_number = btrim(shipment_number) and shipment_number <> '' and char_length(shipment_number) <= 50),
  constraint shipments_dates_check check (arrived_at is null or departed_at is null or arrived_at >= departed_at),
  constraint shipments_text_lengths check (
    char_length(carrier) <= 100 and char_length(awb_or_container_number) <= 100
    and char_length(customer_note) <= 2000)
);

create unique index if not exists shipments_shipment_number_key on public.shipments (upper(shipment_number));
create index if not exists shipments_created_at_idx on public.shipments (created_at);

-- 1 order = 1 inbound package (SPEC §35.0, §35.7). `reference` and `status`
-- carry defaults only so the generated insert type leaves them optional: the
-- BEFORE INSERT trigger always assigns both for signed-in users.
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  reference text not null default '',
  customer_id uuid not null references public.customers (id) on delete restrict,
  created_by_role public.order_creator_role not null default 'customer',
  order_type public.order_type not null default 'personal',
  service_type public.service_type not null default 'air',
  store_vendor text,
  vendor_order_number text,
  description text,
  quantity integer not null default 1,
  estimated_value numeric(12, 2),
  estimated_value_currency public.currency_code not null default 'USD',
  purchase_date date,
  expected_delivery_date date,
  customer_note text,
  tracking_number text,
  -- Matches what receiving staff type or scan, whatever the spacing or dashes.
  tracking_number_normalized text
    generated always as (nullif(upper(regexp_replace(tracking_number, '[^A-Za-z0-9]', '', 'g')), '')) stored,
  carrier text,
  declared_weight_lbs numeric(10, 2),
  measured_weight_lbs numeric(10, 2),
  status text not null default 'order_registered' references public.shipment_statuses (code),
  shipment_id uuid references public.shipments (id) on delete set null,
  parent_order_id uuid references public.orders (id) on delete set null,
  supplier_name text,
  client_po_number text,
  purchase_mode public.purchase_mode,
  received_at timestamptz,
  received_by uuid references auth.users (id) on delete set null,
  picked_up_at timestamptz,
  picked_up_by_name text,
  handed_over_by uuid references auth.users (id) on delete set null,
  cancellation_requested_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  constraint orders_reference_key unique (reference),
  constraint orders_reference_format check (reference ~ '^ORD-[0-9]{4}-[0-9]{5,}$'),
  constraint orders_quantity_check check (quantity between 1 and 100000),
  constraint orders_estimated_value_check check (estimated_value >= 0),
  constraint orders_declared_weight_check check (declared_weight_lbs > 0),
  constraint orders_measured_weight_check check (measured_weight_lbs > 0),
  constraint orders_dates_check
    check (expected_delivery_date is null or purchase_date is null or expected_delivery_date >= purchase_date),
  constraint orders_not_own_parent check (parent_order_id <> id),
  constraint orders_b2b_fields_check check (
    order_type = 'b2b' or (supplier_name is null and client_po_number is null and purchase_mode is null)),
  constraint orders_text_lengths check (
    char_length(store_vendor) <= 200 and char_length(vendor_order_number) <= 100
    and char_length(description) <= 2000 and char_length(customer_note) <= 2000
    and char_length(tracking_number) <= 100 and char_length(carrier) <= 100
    and char_length(supplier_name) <= 200 and char_length(client_po_number) <= 100
    and char_length(picked_up_by_name) <= 200)
);

create index if not exists orders_customer_id_idx on public.orders (customer_id, created_at);
create index if not exists orders_status_idx on public.orders (status);
create index if not exists orders_shipment_id_idx on public.orders (shipment_id);
create index if not exists orders_parent_order_id_idx on public.orders (parent_order_id);
create index if not exists orders_tracking_number_normalized_idx on public.orders (tracking_number_normalized);
create index if not exists orders_created_at_idx on public.orders (created_at);
create index if not exists orders_received_by_idx on public.orders (received_by);
create index if not exists orders_handed_over_by_idx on public.orders (handed_over_by);

-- Append-only; written by the orders_status_history trigger alone.
create table if not exists public.shipment_status_history (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders (id) on delete cascade,
  from_status text not null references public.shipment_statuses (code),
  to_status text not null references public.shipment_statuses (code),
  changed_by uuid,
  changed_at timestamptz not null default now(),
  customer_message text,
  constraint shipment_status_history_message_length check (char_length(customer_message) <= 2000)
);

create index if not exists shipment_status_history_order_idx on public.shipment_status_history (order_id, changed_at);
create index if not exists shipment_status_history_from_status_idx on public.shipment_status_history (from_status);
create index if not exists shipment_status_history_to_status_idx on public.shipment_status_history (to_status);

-- Files live in the private bucket 'order-documents' at
-- {customer_id}/{order_id}/{uuid}.{ext}; the row records one uploaded object.
create table if not exists public.order_documents (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  customer_id uuid not null references public.customers (id) on delete cascade,
  kind public.order_document_kind not null default 'other',
  storage_path text not null,
  original_filename text not null,
  mime_type text not null,
  size_bytes integer not null,
  uploaded_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  constraint order_documents_storage_path_key unique (storage_path),
  constraint order_documents_path_format check (
    storage_path ~ ('^' || customer_id::text || '/' || order_id::text
      || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|jpg|jpeg|png|webp|heic)$')),
  -- Same list as the bucket; never svg or html (SPEC §35.7). coalesce: an
  -- unknown type yields NULL, which a CHECK would let through.
  constraint order_documents_mime_check check (coalesce(
    substring(storage_path from '\.([a-z]+)$') = any (
      case mime_type
        when 'application/pdf' then array['pdf']
        when 'image/jpeg' then array['jpg', 'jpeg']
        when 'image/png' then array['png']
        when 'image/webp' then array['webp']
        when 'image/heic' then array['heic']
      end), false)),
  constraint order_documents_size_check check (size_bytes between 1 and 10485760),
  constraint order_documents_filename_check
    check (btrim(original_filename) <> '' and char_length(original_filename) <= 255)
);

create index if not exists order_documents_order_id_idx on public.order_documents (order_id);
create index if not exists order_documents_customer_id_idx on public.order_documents (customer_id);

-- Staff-only remarks (SPEC §35.3: RLS filters rows, not columns). invoice_id
-- and payment_id get their foreign keys and insert grants in migration 3,
-- which creates those tables; until then no client can fill them.
create table if not exists public.internal_notes (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade,
  order_id uuid references public.orders (id) on delete cascade,
  invoice_id uuid,
  payment_id uuid,
  body text not null,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  constraint internal_notes_one_target check (num_nonnulls(order_id, invoice_id, payment_id) <= 1),
  constraint internal_notes_body_check check (btrim(body) <> '' and char_length(body) <= 5000)
);

create index if not exists internal_notes_customer_id_idx on public.internal_notes (customer_id, created_at);
create index if not exists internal_notes_order_id_idx on public.internal_notes (order_id);
create index if not exists internal_notes_invoice_id_idx on public.internal_notes (invoice_id);
create index if not exists internal_notes_payment_id_idx on public.internal_notes (payment_id);

-- Per-year order numbers (ORD-YYYY-NNNNN). A counter row rather than a
-- sequence: sequences cannot restart per year without DDL at run time, and
-- the row lock keeps numbering safe under concurrent inserts.
create table if not exists private.order_reference_counters (
  year integer primary key,
  last_number integer not null,
  constraint order_reference_counters_positive check (last_number >= 1)
);
revoke all on table private.order_reference_counters from public, anon, authenticated, service_role;

-- staff_tasks.order_id was created without a foreign key in migration 1.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'staff_tasks_order_id_fkey' and conrelid = 'public.staff_tasks'::regclass
  ) then
    alter table public.staff_tasks
      add constraint staff_tasks_order_id_fkey
      foreign key (order_id) references public.orders (id) on delete cascade;
  end if;
end
$$;

-- ===========================================================================
-- Seeds: the §11 statuses mapped to stages (SPEC §35.7). Existing rows are
-- left alone so admin edits survive a re-run. New orders start in the active
-- 'registered' status with the lowest sort_order (order_registered).
-- ===========================================================================

insert into public.shipment_statuses
  (code, label_nl, customer_description_nl, stage, sort_order, is_terminal, customer_visible, notify_customer, active)
values
  ('order_registered', 'Order aangemeld',
   'Uw order is aangemeld bij G&R Solutions. Wij wachten op uw pakket in ons US-magazijn.',
   'registered', 10, false, true, false, true),
  ('pending', 'In behandeling',
   'G&R Solutions verwerkt uw aanmelding.',
   'registered', 20, false, true, false, true),
  ('awaiting_shipment', 'Wacht op verzending door de winkel',
   'De winkel heeft uw pakket nog niet naar ons US-magazijn verzonden.',
   'registered', 30, false, true, false, true),
  ('arrived_us_warehouse', 'Aangekomen in US-magazijn',
   'Uw pakket is ontvangen en gewogen in ons magazijn in de Verenigde Staten.',
   'us_warehouse', 40, false, true, true, true),
  ('in_transit', 'Onderweg naar Suriname',
   'Uw pakket is onderweg naar Suriname.',
   'in_transit', 50, false, true, true, true),
  ('arrived_suriname', 'Aangekomen in Suriname',
   'Uw pakket is aangekomen in Suriname.',
   'arrived_sr', 60, false, true, true, true),
  ('at_customs', 'Bij de douane',
   'Uw pakket wordt ingeklaard bij de douane.',
   'at_customs', 70, false, true, false, true),
  ('customs_cleared', 'Ingeklaard',
   'Uw pakket is door de douane vrijgegeven.',
   'cleared', 80, false, true, false, true),
  ('ready_for_pickup', 'Klaar voor afhalen',
   'Uw pakket ligt klaar om af te halen bij G&R Solutions.',
   'ready_for_pickup', 90, false, true, true, true),
  ('picked_up', 'Afgehaald',
   'Uw pakket is afgehaald.',
   'completed', 100, true, true, false, true),
  -- Offered in the UI only while company_settings.delivery_available is on.
  ('delivered', 'Bezorgd',
   'Uw pakket is bezorgd.',
   'completed', 110, true, true, false, true),
  ('documents_required', 'Actie vereist – documenten nodig',
   'Wij hebben documenten van u nodig om uw pakket verder te verwerken. Lees het bericht hieronder en upload de gevraagde documenten.',
   'action_required', 120, false, true, true, true),
  ('cancelled', 'Geannuleerd',
   'Deze order is geannuleerd.',
   'cancelled', 130, true, true, true, true)
on conflict (code) do nothing;

-- ===========================================================================
-- Storage bucket (SPEC §35.7). The Storage API enforces size and MIME limits.
-- ===========================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('order-documents', 'order-documents', false, 10485760,
        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- ===========================================================================
-- Private helpers
-- ===========================================================================

create or replace function private.initial_order_status()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  _code text;
begin
  select s.code into _code
  from public.shipment_statuses s
  where s.stage = 'registered' and s.active
  order by s.sort_order, s.code
  limit 1;
  if _code is null then
    raise exception 'Er is geen actieve beginstatus (fase "registered")' using errcode = '55000';
  end if;
  return _code;
end
$$;

-- Numbers per Suriname calendar year, gapless except for rolled-back inserts.
-- Past 99999 the number simply gets more digits (as invoice numbers do), so
-- no flood of orders can ever stop the business from registering packages.
create or replace function private.next_order_reference()
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  _year integer := extract(year from (now() at time zone 'America/Paramaribo'))::integer;
  _n integer;
begin
  insert into private.order_reference_counters as c (year, last_number)
  values (_year, 1)
  on conflict (year) do update set last_number = c.last_number + 1
  returning c.last_number into _n;
  return format('ORD-%s-%s', _year, case when _n > 99999 then _n::text else lpad(_n::text, 5, '0') end);
end
$$;

-- "Extra pakket toevoegen" (SPEC §35.0): siblings hang off one parent of the
-- same customer, one level deep, so groups never form cycles.
create or replace function private.check_order_parent(_order_id uuid, _customer_id uuid, _parent_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  _parent record;
begin
  if _parent_id is null then
    return;
  end if;
  if _parent_id = _order_id then
    raise exception 'Een order kan niet aan zichzelf worden gekoppeld' using errcode = '22023';
  end if;
  select p.customer_id, p.parent_order_id into _parent from public.orders p where p.id = _parent_id;
  if not found or _parent.customer_id is distinct from _customer_id then
    raise exception 'Hoofdorder niet gevonden voor deze klant' using errcode = '22023';
  end if;
  if _parent.parent_order_id is not null then
    raise exception 'Koppel een extra pakket aan de hoofdorder, niet aan een ander extra pakket'
      using errcode = '22023';
  end if;
  if exists (select 1 from public.orders c where c.parent_order_id = _order_id) then
    raise exception 'Deze order heeft zelf extra pakketten en kan niet aan een andere order worden gekoppeld'
      using errcode = '22023';
  end if;
end
$$;

-- Shared by change_order_status and receive_order, after their guards. Locks
-- the orders, moves them, and reports per order whether the customer should
-- be e-mailed. Orders already in the target status are reported unchanged.
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
-- Trigger functions
-- ===========================================================================

-- SPEC §35.7: customers insert only for themselves, and every column outside
-- the customer-editable list is reset. Every client insert starts in the
-- initial status; later moves go through change_order_status / receive_order.
create or replace function private.orders_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid uuid := (select auth.uid());
  _staff boolean;
  _own uuid;
  _limit integer;
  _open integer;
begin
  if _uid is not null then
    _staff := public.is_staff();
    if not _staff then
      _own := public.current_customer_id();
      -- BEFORE triggers run ahead of the RLS check: deny first.
      if _own is null or new.customer_id is distinct from _own then
        raise exception 'Geen toegang' using errcode = '42501';
      end if;
      new.measured_weight_lbs := null;
      new.shipment_id := null;
      if not exists (
        select 1 from public.service_rates r where r.service_type = new.service_type and r.enabled
      ) then
        raise exception 'Verzending per % is op dit moment niet beschikbaar', new.service_type
          using errcode = '22023';
      end if;
      -- Anyone can sign up, so one account must not be able to flood the
      -- order book (bulk inserts included: a row trigger sees the rows the
      -- same statement inserted before it). The customer row lock makes
      -- concurrent requests of one customer count one after the other.
      perform 1 from public.customers c where c.id = _own for no key update;
      _limit := coalesce((select s.max_open_orders_per_customer from public.company_settings s where s.id), 50);
      select count(*) into _open
      from public.orders o join public.shipment_statuses s on s.code = o.status
      where o.customer_id = _own and o.created_by_role = 'customer' and s.stage = 'registered';
      if _open >= _limit then
        raise exception 'U heeft al % aangemelde orders die G&R nog niet heeft ontvangen. Neem contact op met G&R Solutions om meer orders aan te melden.', _open
          using errcode = '54000', hint = 'open_order_limit';
      end if;
    elsif exists (select 1 from public.customers c where c.id = new.customer_id and c.status = 'disabled') then
      raise exception 'Deze klant is gedeactiveerd' using errcode = '55000';
    end if;

    new.status := private.initial_order_status();
    new.created_by_role := case when _staff then 'staff' else 'customer' end::public.order_creator_role;
    new.created_at := now();
    new.created_by := _uid;
    new.updated_at := now();
    new.updated_by := _uid;
    new.received_at := null;
    new.received_by := null;
    new.picked_up_at := null;
    new.picked_up_by_name := null;
    new.handed_over_by := null;
    new.cancellation_requested_at := null;
  end if;

  perform private.check_order_parent(new.id, new.customer_id, new.parent_order_id);
  new.reference := private.next_order_reference();
  return new;
end
$$;

-- Customers change only the fields they entered, and only while the order is
-- in the 'registered' stage. Nobody signed in changes status, receiving,
-- pickup, ownership or authorship columns except through the RPCs.
create or replace function private.orders_guard_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid uuid := (select auth.uid());
  _customer_editable constant text[] := array[
    'order_type', 'service_type', 'store_vendor', 'vendor_order_number', 'description',
    'quantity', 'estimated_value', 'estimated_value_currency', 'purchase_date',
    'expected_delivery_date', 'customer_note', 'tracking_number', 'carrier',
    'declared_weight_lbs', 'supplier_name', 'client_po_number', 'purchase_mode'];
  _staff_editable constant text[] := array['measured_weight_lbs', 'shipment_id', 'parent_order_id'];
  _changed text[];
begin
  if _uid is not null and coalesce(current_setting('app.order_internal_write', true), '') <> 'on' then
    -- The generated column is not computed yet in a BEFORE trigger.
    select coalesce(array_agg(n.key), '{}') into _changed
    from jsonb_each(to_jsonb(new)) n
    where n.key not in ('updated_at', 'updated_by', 'tracking_number_normalized')
      and n.value is distinct from (to_jsonb(old) -> n.key);

    if public.is_staff() then
      if not _changed <@ (_customer_editable || _staff_editable) then
        raise exception 'Geen toegang: status, ontvangst en afhalen wijzigen alleen via de orderacties'
          using errcode = '42501';
      end if;
    else
      if not _changed <@ _customer_editable then
        raise exception 'Geen toegang' using errcode = '42501';
      end if;
      if cardinality(_changed) > 0 and not exists (
        select 1 from public.shipment_statuses s where s.code = old.status and s.stage = 'registered'
      ) then
        raise exception 'Deze order kan niet meer worden gewijzigd: G&R Solutions verwerkt het pakket al'
          using errcode = '55000';
      end if;
      if 'service_type' = any (_changed) and not exists (
        select 1 from public.service_rates r where r.service_type = new.service_type and r.enabled
      ) then
        raise exception 'Verzending per % is op dit moment niet beschikbaar', new.service_type
          using errcode = '22023';
      end if;
    end if;
  end if;

  if new.parent_order_id is distinct from old.parent_order_id then
    perform private.check_order_parent(new.id, new.customer_id, new.parent_order_id);
  end if;
  return new;
end
$$;

create or replace function private.orders_status_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.shipment_status_history (order_id, from_status, to_status, changed_by, changed_at, customer_message)
  values (
    new.id, old.status, new.status, (select auth.uid()), now(),
    nullif(btrim(current_setting('app.status_message', true)), '')
  );
  return null;
end
$$;

-- New orders need an active 'registered' status to start in.
create or replace function private.shipment_statuses_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.shipment_statuses s where s.stage = 'registered' and s.active) then
    raise exception 'Minstens één status in de fase "registered" moet actief blijven: nieuwe orders beginnen daar'
      using errcode = '55000';
  end if;
  return null;
end
$$;

-- The customer and authorship come from the order and the session, never
-- from the client; the object must already be uploaded to the bucket.
create or replace function private.order_documents_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid uuid := (select auth.uid());
  _order record;
  _exists boolean;
begin
  select o.customer_id, s.stage into _order
  from public.orders o join public.shipment_statuses s on s.code = o.status
  where o.id = new.order_id;
  _exists := found;

  if _uid is not null then
    if not public.is_staff() then
      if not _exists or _order.customer_id is distinct from public.current_customer_id() then
        raise exception 'Geen toegang' using errcode = '42501';
      end if;
      if _order.stage in ('completed', 'cancelled') then
        raise exception 'Bij een afgeronde of geannuleerde order kunnen geen documenten meer worden toegevoegd'
          using errcode = '55000';
      end if;
    end if;
    new.uploaded_by := _uid;
    new.created_at := now();
  end if;
  if not _exists then
    raise exception 'Order niet gevonden' using errcode = 'P0002';
  end if;

  new.customer_id := _order.customer_id;
  if new.storage_path not like new.customer_id::text || '/' || new.order_id::text || '/%' then
    raise exception 'Het bestand staat niet in de map van deze order' using errcode = '22023';
  end if;
  if not exists (
    select 1 from storage.objects so where so.bucket_id = 'order-documents' and so.name = new.storage_path
  ) then
    raise exception 'Upload het bestand eerst naar de documentenopslag' using errcode = '22023';
  end if;
  return new;
end
$$;

create or replace function private.internal_notes_stamp()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid uuid := (select auth.uid());
begin
  if _uid is not null then
    if not public.is_staff() then
      raise exception 'Geen toegang' using errcode = '42501';
    end if;
    new.created_at := now();
    new.created_by := _uid;
    new.updated_by := _uid;
  end if;
  if new.order_id is not null and not exists (
    select 1 from public.orders o where o.id = new.order_id and o.customer_id = new.customer_id
  ) then
    raise exception 'Deze order hoort niet bij deze klant' using errcode = '22023';
  end if;
  return new;
end
$$;

-- ===========================================================================
-- Triggers
-- ===========================================================================

drop trigger if exists shipment_statuses_touch_updated_at on public.shipment_statuses;
create trigger shipment_statuses_touch_updated_at
  before update on public.shipment_statuses
  for each row execute function private.touch_updated_at();

drop trigger if exists shipment_statuses_guard on public.shipment_statuses;
create trigger shipment_statuses_guard
  after update of stage, active on public.shipment_statuses
  for each row execute function private.shipment_statuses_guard();

drop trigger if exists shipment_statuses_audit on public.shipment_statuses;
create trigger shipment_statuses_audit
  after insert or update or delete on public.shipment_statuses
  for each row execute function private.audit_row('code');

drop trigger if exists shipments_touch_updated_at on public.shipments;
create trigger shipments_touch_updated_at
  before update on public.shipments
  for each row execute function private.touch_updated_at();

drop trigger if exists shipments_audit on public.shipments;
create trigger shipments_audit
  after insert or update or delete on public.shipments
  for each row execute function private.audit_row();

drop trigger if exists orders_before_insert on public.orders;
create trigger orders_before_insert
  before insert on public.orders
  for each row execute function private.orders_before_insert();

-- Fires before orders_touch_updated_at (trigger names sort alphabetically).
drop trigger if exists orders_guard_update on public.orders;
create trigger orders_guard_update
  before update on public.orders
  for each row execute function private.orders_guard_update();

drop trigger if exists orders_touch_updated_at on public.orders;
create trigger orders_touch_updated_at
  before update on public.orders
  for each row execute function private.touch_updated_at();

drop trigger if exists orders_status_history on public.orders;
create trigger orders_status_history
  after update of status on public.orders
  for each row when (old.status is distinct from new.status)
  execute function private.orders_status_history();

drop trigger if exists orders_audit on public.orders;
create trigger orders_audit
  after insert or update or delete on public.orders
  for each row execute function private.audit_row();

drop trigger if exists order_documents_before_insert on public.order_documents;
create trigger order_documents_before_insert
  before insert on public.order_documents
  for each row execute function private.order_documents_before_insert();

drop trigger if exists internal_notes_stamp on public.internal_notes;
create trigger internal_notes_stamp
  before insert on public.internal_notes
  for each row execute function private.internal_notes_stamp();

drop trigger if exists internal_notes_touch_updated_at on public.internal_notes;
create trigger internal_notes_touch_updated_at
  before update on public.internal_notes
  for each row execute function private.touch_updated_at();

-- ===========================================================================
-- RPCs for signed-in users. Each starts with its access guard (SPEC §35.3).
-- ===========================================================================

-- The one way to change order statuses, single or bulk (SPEC §35.7). The
-- calling server function e-mails where notify is true, at most once per
-- customer per action (SPEC §35.12).
create or replace function public.change_order_status(
  _order_ids uuid[],
  _to_status text,
  _customer_message text default null,
  _picked_up_by_name text default null
)
returns table (order_id uuid, history_id bigint, customer_id uuid, notify boolean)
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not (select public.is_staff()) then
    raise exception 'Geen toegang' using errcode = '42501';
  end if;
  return query
    select a.o_order_id, a.o_history_id, a.o_customer_id, a.o_notify
    from private.apply_order_status(_order_ids, _to_status, _customer_message, _picked_up_by_name) a;
end
$$;

-- "Ontvangen in US-magazijn" (SPEC §35.7): records the measured weight and
-- moves the order to the first active us_warehouse status. Receiving again
-- while it is still there only corrects the weight.
create or replace function public.receive_order(_order_id uuid, _measured_weight_lbs numeric)
returns table (order_id uuid, history_id bigint, customer_id uuid, notify boolean)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  _uid uuid := (select auth.uid());
  _weight numeric := round(_measured_weight_lbs, 2);
  _order record;
  _target text;
begin
  if not (select public.is_staff()) then
    raise exception 'Geen toegang' using errcode = '42501';
  end if;
  if _weight is null or _weight <= 0 or _weight > 99999999.99 then
    raise exception 'Vul een gewicht in lbs groter dan 0 in' using errcode = '22023';
  end if;

  select o.id, o.customer_id, o.received_at, s.stage into _order
  from public.orders o join public.shipment_statuses s on s.code = o.status
  where o.id = _order_id
  for update of o;
  if not found then
    raise exception 'Order niet gevonden' using errcode = 'P0002';
  end if;
  if not (_order.stage in ('registered', 'us_warehouse')
          or (_order.stage = 'action_required' and _order.received_at is null)) then
    raise exception 'Deze order is al verder dan het US-magazijn en kan niet opnieuw worden ontvangen'
      using errcode = '55000';
  end if;
  if _order.stage <> 'us_warehouse' then
    select s.code into _target
    from public.shipment_statuses s
    where s.stage = 'us_warehouse' and s.active
    order by s.sort_order, s.code
    limit 1;
    if _target is null then
      raise exception 'Er is geen actieve status voor het US-magazijn' using errcode = '55000';
    end if;
  end if;

  perform set_config('app.order_internal_write', 'on', true);
  update public.orders o set
    measured_weight_lbs = _weight,
    received_at = coalesce(o.received_at, now()),
    received_by = coalesce(o.received_by, _uid)
  where o.id = _order.id;
  perform set_config('app.order_internal_write', '', true);

  if _target is null then
    return query select _order.id, null::bigint, _order.customer_id, false;
  else
    return query
      select a.o_order_id, a.o_history_id, a.o_customer_id, a.o_notify
      from private.apply_order_status(array[_order.id], _target, null, null) a;
  end if;
end
$$;

-- "Annulering aanvragen" (SPEC §35.7): the owner asks, staff decide. The
-- timestamp is set once; repeating the request changes nothing.
create or replace function public.request_order_cancellation(_order_id uuid)
returns timestamptz
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  _cid uuid := (select public.current_customer_id());
  _order record;
  _at timestamptz;
begin
  if _cid is null then
    raise exception 'Geen toegang' using errcode = '42501';
  end if;
  select o.id, o.reference, o.cancellation_requested_at, s.stage, c.full_name, c.customer_code
    into _order
  from public.orders o
  join public.shipment_statuses s on s.code = o.status
  join public.customers c on c.id = o.customer_id
  where o.id = _order_id and o.customer_id = _cid
  for update of o;
  if not found then
    raise exception 'Geen toegang' using errcode = '42501';
  end if;
  if _order.cancellation_requested_at is not null then
    return _order.cancellation_requested_at;
  end if;
  if _order.stage in ('completed', 'cancelled') then
    raise exception 'Deze order is al afgerond of geannuleerd' using errcode = '55000';
  end if;

  perform set_config('app.order_internal_write', 'on', true);
  update public.orders o set cancellation_requested_at = now()
  where o.id = _order.id
  returning o.cancellation_requested_at into _at;
  perform set_config('app.order_internal_write', '', true);

  perform private.add_staff_task(
    'order_cancellation_request',
    _cid,
    format('Klant %s (%s) vraagt om annulering van order %s.', _order.full_name, _order.customer_code, _order.reference),
    _order.id);
  return _at;
end
$$;

-- ===========================================================================
-- Row level security: one policy per command, all to authenticated. Disabled
-- customers have no current_customer_id() and therefore see nothing.
-- ===========================================================================

alter table public.shipment_statuses enable row level security;
alter table public.shipments enable row level security;
alter table public.orders enable row level security;
alter table public.shipment_status_history enable row level security;
alter table public.order_documents enable row level security;
alter table public.internal_notes enable row level security;

-- Inactive statuses stay readable: existing orders and history still use them.
drop policy if exists shipment_statuses_select on public.shipment_statuses;
create policy shipment_statuses_select on public.shipment_statuses
  for select to authenticated
  using (
    (select public.is_staff())
    or (customer_visible and (select public.current_customer_id()) is not null)
  );

drop policy if exists shipment_statuses_insert on public.shipment_statuses;
create policy shipment_statuses_insert on public.shipment_statuses
  for insert to authenticated
  with check ((select public.is_admin()));

drop policy if exists shipment_statuses_update on public.shipment_statuses;
create policy shipment_statuses_update on public.shipment_statuses
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

drop policy if exists shipments_select on public.shipments;
create policy shipments_select on public.shipments
  for select to authenticated
  using (
    (select public.is_staff())
    or exists (
      select 1 from public.orders o
      where o.shipment_id = shipments.id and o.customer_id = (select public.current_customer_id())
    )
  );

drop policy if exists shipments_insert on public.shipments;
create policy shipments_insert on public.shipments
  for insert to authenticated
  with check ((select public.is_staff()));

drop policy if exists shipments_update on public.shipments;
create policy shipments_update on public.shipments
  for update to authenticated
  using ((select public.is_staff()))
  with check ((select public.is_staff()));

drop policy if exists orders_select on public.orders;
create policy orders_select on public.orders
  for select to authenticated
  using (customer_id = (select public.current_customer_id()) or (select public.is_staff()));

drop policy if exists orders_insert on public.orders;
create policy orders_insert on public.orders
  for insert to authenticated
  with check (customer_id = (select public.current_customer_id()) or (select public.is_staff()));

drop policy if exists orders_update on public.orders;
create policy orders_update on public.orders
  for update to authenticated
  using (customer_id = (select public.current_customer_id()) or (select public.is_staff()))
  with check (customer_id = (select public.current_customer_id()) or (select public.is_staff()));

drop policy if exists shipment_status_history_select on public.shipment_status_history;
create policy shipment_status_history_select on public.shipment_status_history
  for select to authenticated
  using (
    (select public.is_staff())
    or (
      exists (
        select 1 from public.orders o
        where o.id = shipment_status_history.order_id
          and o.customer_id = (select public.current_customer_id())
      )
      and exists (
        select 1 from public.shipment_statuses s
        where s.code = shipment_status_history.to_status and s.customer_visible
      )
    )
  );

drop policy if exists order_documents_select on public.order_documents;
create policy order_documents_select on public.order_documents
  for select to authenticated
  using (customer_id = (select public.current_customer_id()) or (select public.is_staff()));

drop policy if exists order_documents_insert on public.order_documents;
create policy order_documents_insert on public.order_documents
  for insert to authenticated
  with check (customer_id = (select public.current_customer_id()) or (select public.is_staff()));

drop policy if exists order_documents_delete on public.order_documents;
create policy order_documents_delete on public.order_documents
  for delete to authenticated
  using ((select public.is_staff()));

drop policy if exists internal_notes_select on public.internal_notes;
create policy internal_notes_select on public.internal_notes
  for select to authenticated
  using ((select public.is_staff()));

drop policy if exists internal_notes_insert on public.internal_notes;
create policy internal_notes_insert on public.internal_notes
  for insert to authenticated
  with check ((select public.is_staff()));

drop policy if exists internal_notes_update on public.internal_notes;
create policy internal_notes_update on public.internal_notes
  for update to authenticated
  using ((select public.is_staff()))
  with check ((select public.is_staff()));

drop policy if exists internal_notes_delete on public.internal_notes;
create policy internal_notes_delete on public.internal_notes
  for delete to authenticated
  using ((select public.is_admin()));

-- Storage: {customer_id}/{order_id}/{file}. Customers read their own folder
-- and upload only into folders of their own orders; staff read, upload and
-- delete; nobody updates (no overwrites).
drop policy if exists order_documents_objects_select on storage.objects;
create policy order_documents_objects_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'order-documents'
    and (
      (storage.foldername(name))[1] = (select public.current_customer_id())::text
      or (select public.is_staff())
    )
  );

drop policy if exists order_documents_objects_insert on storage.objects;
create policy order_documents_objects_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'order-documents'
    and (
      (storage.foldername(name))[1] = (select public.current_customer_id())::text
      or (select public.is_staff())
    )
    and array_length(storage.foldername(name), 1) = 2
    and exists (
      select 1 from public.orders o
      where o.id::text = (storage.foldername(name))[2]
        and o.customer_id::text = (storage.foldername(name))[1]
    )
  );

drop policy if exists order_documents_objects_delete on storage.objects;
create policy order_documents_objects_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'order-documents' and (select public.is_staff()));

-- ===========================================================================
-- Grants. Column lists keep status, reference, receiving, pickup and
-- authorship columns out of every client's reach.
-- ===========================================================================

revoke all on table
  public.shipment_statuses, public.shipments, public.orders, public.shipment_status_history,
  public.order_documents, public.internal_notes
from anon, authenticated, service_role;

grant select on public.shipment_statuses to authenticated;
grant insert (code, label_nl, customer_description_nl, stage, sort_order, is_terminal,
              customer_visible, notify_customer, active)
  on public.shipment_statuses to authenticated;
grant update (label_nl, customer_description_nl, stage, sort_order, is_terminal,
              customer_visible, notify_customer, active)
  on public.shipment_statuses to authenticated;

grant select on public.shipments to authenticated;
grant insert (shipment_number, service_type, carrier, awb_or_container_number, departed_at,
              arrived_at, customer_note)
  on public.shipments to authenticated;
grant update (shipment_number, service_type, carrier, awb_or_container_number, departed_at,
              arrived_at, customer_note)
  on public.shipments to authenticated;

grant select on public.orders to authenticated;
grant insert (customer_id, order_type, service_type, store_vendor, vendor_order_number, description,
              quantity, estimated_value, estimated_value_currency, purchase_date,
              expected_delivery_date, customer_note, tracking_number, carrier, declared_weight_lbs,
              supplier_name, client_po_number, purchase_mode, parent_order_id,
              measured_weight_lbs, shipment_id)
  on public.orders to authenticated;
grant update (order_type, service_type, store_vendor, vendor_order_number, description,
              quantity, estimated_value, estimated_value_currency, purchase_date,
              expected_delivery_date, customer_note, tracking_number, carrier, declared_weight_lbs,
              supplier_name, client_po_number, purchase_mode, parent_order_id,
              measured_weight_lbs, shipment_id)
  on public.orders to authenticated;

grant select on public.shipment_status_history to authenticated;

grant select, delete on public.order_documents to authenticated;
grant insert (order_id, customer_id, kind, storage_path, original_filename, mime_type, size_bytes)
  on public.order_documents to authenticated;

grant select, delete on public.internal_notes to authenticated;
grant insert (customer_id, order_id, body) on public.internal_notes to authenticated;
grant update (body) on public.internal_notes to authenticated;

-- Server code reads order data for e-mails (SPEC §35.12); it writes through the user's client.
grant select on public.shipment_statuses to service_role;
grant select on public.shipments to service_role;
grant select on public.orders to service_role;
grant select on public.shipment_status_history to service_role;
grant select on public.order_documents to service_role;

revoke all on sequence public.shipment_status_history_id_seq from public, anon, authenticated, service_role;

revoke all on function
  public.change_order_status(uuid[], text, text, text),
  public.receive_order(uuid, numeric),
  public.request_order_cancellation(uuid)
from public, anon, authenticated, service_role;

grant execute on function
  public.change_order_status(uuid[], text, text, text),
  public.receive_order(uuid, numeric),
  public.request_order_cancellation(uuid)
to authenticated;

revoke all on function
  private.initial_order_status(),
  private.next_order_reference(),
  private.check_order_parent(uuid, uuid, uuid),
  private.apply_order_status(uuid[], text, text, text),
  private.orders_before_insert(),
  private.orders_guard_update(),
  private.orders_status_history(),
  private.shipment_statuses_guard(),
  private.order_documents_before_insert(),
  private.internal_notes_stamp()
from public, anon, authenticated, service_role;
