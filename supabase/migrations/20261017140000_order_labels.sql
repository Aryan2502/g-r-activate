-- Owner decisions of 2026-10-17, second round (docs/SPEC.md §36):
--
-- 1. Customers write no code on the parcel: no "GR67", no "Air"/"Ocean". The
--    US address is sent to just their name (packages are matched by the Track
--    & Trace code they register). New defaults, and addresses that still have
--    a default name line ('{FULL_NAME} {GR_CODE}' from the start, or
--    '{GR_CODE} {SERVICE} {FULL_NAME}' from 20261017090000) get
--    '{FULL_NAME}'; a line 2 of just '{GR_CODE}' becomes empty. Templates the
--    owner wrote differently stay.
-- 2. Order labels: the team puts free-text labels with a colour on orders
--    (e.g. "Air" or "Ocean"), as many as they like. No preset labels. Only the
--    team sees them; they are added and removed, never edited, and every
--    change is in the audit log. A label is unique per order (ignoring case
--    and surrounding spaces), so labelling the same orders twice is harmless.
--
-- Idempotent. Generated types gain the order_labels table.

-- ===========================================================================
-- 1. US address: just the customer's name
-- ===========================================================================

alter table public.warehouse_addresses
  alter column recipient_name_template set default '{FULL_NAME}',
  alter column address_line2_template set default '';

update public.warehouse_addresses
   set recipient_name_template = '{FULL_NAME}'
 where recipient_name_template in ('{FULL_NAME} {GR_CODE}', '{GR_CODE} {SERVICE} {FULL_NAME}');

update public.warehouse_addresses
   set address_line2_template = ''
 where address_line2_template = '{GR_CODE}';

-- ===========================================================================
-- 2. Order labels
-- ===========================================================================

create table if not exists public.order_labels (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  label text not null,
  label_key text not null generated always as (lower(label)) stored,
  color text not null default 'grey',
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  constraint order_labels_label_check
    check (label = btrim(label) and label <> '' and char_length(label) <= 30),
  constraint order_labels_color_check
    check (color in ('grey', 'brown', 'red', 'orange', 'yellow', 'green', 'teal', 'blue')),
  -- Also the index of the foreign key, and the conflict target of "label
  -- these orders" (insert … on conflict do nothing).
  constraint order_labels_order_label_key unique (order_id, label_key)
);

alter table public.order_labels enable row level security;

drop policy if exists order_labels_select on public.order_labels;
create policy order_labels_select on public.order_labels
  for select to authenticated
  using ((select public.is_staff()));

drop policy if exists order_labels_insert on public.order_labels;
create policy order_labels_insert on public.order_labels
  for insert to authenticated
  with check ((select public.is_staff()));

drop policy if exists order_labels_delete on public.order_labels;
create policy order_labels_delete on public.order_labels
  for delete to authenticated
  using ((select public.is_staff()));

revoke all on table public.order_labels from anon, authenticated, service_role;
grant select, delete on public.order_labels to authenticated;
grant insert (order_id, label, color) on public.order_labels to authenticated;

drop trigger if exists order_labels_audit on public.order_labels;
create trigger order_labels_audit
  after insert or update or delete on public.order_labels
  for each row execute function private.audit_row();
