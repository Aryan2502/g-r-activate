-- Migration 3 of P2a (SPEC §35.3): billing & messaging.
--
-- Invoices with their lines and gapless numbers, payments, the overview view
-- that computes balances and overdue state, the pay-before-pickup rule, and the
-- e-mail log and job-run tables used by server code.
--
-- Same conventions as migrations 1 and 2. Additions here:
-- * Invoices are written by staff with their own client, but only while they
--   are drafts. Status, number, totals and snapshots are never client-writable:
--   they change only through the RPCs below, which pass the guard with the
--   transaction-local flag app.invoice_mutation ('totals', 'issue', 'payment',
--   'cancel', 'late_fee'). Payments are voided through app.payment_mutation.
-- * Unlike most rules in migrations 1 and 2, invoice and payment immutability
--   also binds trusted writers (service role, SQL editor): SPEC §35.15 requires
--   that nobody can modify an issued invoice.
-- * Totals (SPEC §35.9), matched by computeInvoiceTotals() in TS:
--     total_lbs        = sum(weight_lbs) of freight lines
--     subtotal_freight = sum(amount) of freight lines
--     total_charges    = sum(amount) of every line except discounts
--     total_discount   = -sum(amount) of discount lines (stored as a positive number)
--     total_amount     = total_charges - total_discount, never below 0
--     vat_amount       = round(max(0, sum(amount) of non-exempt lines) * vat_rate / (100 + vat_rate), 2),
--                        null while vat_rate is null
--   round() on numeric rounds half away from zero, i.e. half-up for these
--   non-negative values. Freight amounts are round(weight_lbs * rate_per_lb, 2),
--   computed here whatever the client sends.

-- ===========================================================================
-- Types
-- ===========================================================================

do $$
begin
  if to_regtype('public.invoice_status') is null then
    create type public.invoice_status as enum ('draft', 'open', 'partially_paid', 'paid', 'cancelled');
  end if;
  if to_regtype('public.invoice_line_type') is null then
    create type public.invoice_line_type as enum (
      'freight', 'customs', 'handling', 'goods', 'service_fee', 'other', 'discount', 'late_fee'
    );
  end if;
  if to_regtype('public.payment_method') is null then
    create type public.payment_method as enum ('bank_transfer', 'cash', 'pin', 'mobile', 'other');
  end if;
  if to_regtype('public.email_kind') is null then
    create type public.email_kind as enum (
      'invitation', 'welcome', 'order_confirmation', 'status_update', 'invoice_issued',
      'payment_received', 'payment_reminder_due_soon', 'payment_reminder_overdue'
    );
  end if;
  if to_regtype('public.email_status') is null then
    create type public.email_status as enum ('queued', 'sent', 'failed', 'skipped_no_provider');
  end if;
  if to_regtype('public.job_trigger') is null then
    create type public.job_trigger as enum ('cron', 'manual');
  end if;
  if to_regtype('public.job_run_status') is null then
    create type public.job_run_status as enum ('running', 'succeeded', 'failed');
  end if;
end
$$;

-- ===========================================================================
-- Tables
-- ===========================================================================

-- One row per year; the row lock in issue_invoice makes numbers gapless, since
-- a failed issue rolls the increment back with everything else.
create table if not exists public.invoice_number_counters (
  year integer primary key,
  last_number integer not null default 0,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  constraint invoice_number_counters_year_check check (year between 2000 and 2999),
  constraint invoice_number_counters_last_number_check check (last_number between 0 and 99999999)
);

-- Drafts have no number and render from live settings; issued invoices render
-- only from their snapshots (SPEC §35.9). due_date has no column default
-- because it depends on invoice_date and a setting: API inserts send it (the
-- builder shows it); a SQL insert without it gets invoice_date + payment_term_days.
create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_number text,
  customer_id uuid not null references public.customers (id) on delete restrict,
  currency public.currency_code not null default 'USD',
  invoice_date date not null default ((now() at time zone 'America/Paramaribo')::date),
  due_date date not null,
  status public.invoice_status not null default 'draft',
  total_lbs numeric(10, 2) not null default 0,
  subtotal_freight numeric(12, 2) not null default 0,
  total_charges numeric(12, 2) not null default 0,
  total_discount numeric(12, 2) not null default 0,
  total_amount numeric(12, 2) not null default 0,
  vat_rate numeric(5, 2),
  vat_amount numeric(12, 2),
  customer_note text,
  issuer_snapshot jsonb,
  bill_to_snapshot jsonb,
  issued_at timestamptz,
  issued_by uuid,
  paid_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by uuid,
  cancel_reason text,
  replaces_invoice_id uuid references public.invoices (id) on delete restrict,
  first_reminder_sent_at timestamptz,
  last_reminder_sent_at timestamptz,
  reminder_count integer not null default 0,
  late_fee_applied_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  constraint invoices_invoice_number_key unique (invoice_number),
  constraint invoices_number_check check (
    (status = 'draft') = (invoice_number is null)
    and (invoice_number is null or (btrim(invoice_number) <> '' and char_length(invoice_number) <= 40))),
  constraint invoices_issued_check check (
    status = 'draft' or (issued_at is not null and issuer_snapshot is not null and bill_to_snapshot is not null)),
  constraint invoices_snapshots_check check (
    (issuer_snapshot is null or jsonb_typeof(issuer_snapshot) = 'object')
    and (bill_to_snapshot is null or jsonb_typeof(bill_to_snapshot) = 'object')),
  constraint invoices_paid_check check ((status = 'paid') = (paid_at is not null)),
  constraint invoices_cancelled_check check (
    (status = 'cancelled') = (cancelled_at is not null)
    and (status <> 'cancelled' or nullif(btrim(cancel_reason), '') is not null)),
  constraint invoices_dates_check check (
    due_date >= invoice_date and invoice_date between date '2000-01-01' and date '2999-12-31'),
  constraint invoices_totals_check check (
    total_lbs >= 0 and subtotal_freight >= 0 and total_charges >= 0 and total_discount >= 0
    and total_amount >= 0 and vat_amount >= 0),
  constraint invoices_vat_check check (
    vat_rate between 0 and 100 and (vat_rate is null) = (vat_amount is null)),
  constraint invoices_reminder_count_check check (reminder_count >= 0),
  constraint invoices_late_fee_check check (late_fee_applied_at is null or status <> 'draft'),
  constraint invoices_not_own_replacement check (replaces_invoice_id <> id),
  constraint invoices_text_lengths check (
    char_length(customer_note) <= 2000 and char_length(cancel_reason) <= 500)
);

create index if not exists invoices_customer_id_idx on public.invoices (customer_id, invoice_date);
create index if not exists invoices_status_idx on public.invoices (status);
create index if not exists invoices_due_date_idx on public.invoices (due_date)
  where status in ('open', 'partially_paid');
create index if not exists invoices_replaces_invoice_id_idx on public.invoices (replaces_invoice_id);
create index if not exists invoices_invoice_date_idx on public.invoices (invoice_date);

-- vat_exempt has no default on purpose: the SPEC default depends on the line
-- type (true for customs), which a column default cannot express. API inserts
-- must choose; a SQL insert without it gets the SPEC default from the trigger.
create table if not exists public.invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices (id) on delete cascade,
  order_id uuid references public.orders (id) on delete restrict,
  line_type public.invoice_line_type not null,
  description text not null,
  weight_lbs numeric(10, 2),
  rate_per_lb numeric(12, 2),
  amount numeric(12, 2) not null,
  vat_exempt boolean not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  constraint invoice_items_freight_check check (
    line_type <> 'freight'
    or (order_id is not null and weight_lbs > 0 and rate_per_lb >= 0
        and amount = round(weight_lbs * rate_per_lb, 2))),
  constraint invoice_items_weight_rate_check check (
    line_type = 'freight' or (weight_lbs is null and rate_per_lb is null)),
  constraint invoice_items_amount_sign_check check (
    case when line_type = 'discount' then amount <= 0 else amount >= 0 end),
  constraint invoice_items_late_fee_check check (line_type <> 'late_fee' or order_id is null),
  constraint invoice_items_description_check check (btrim(description) <> '' and char_length(description) <= 500),
  constraint invoice_items_sort_order_check check (sort_order between 0 and 10000)
);

create index if not exists invoice_items_invoice_id_idx on public.invoice_items (invoice_id, sort_order);
create index if not exists invoice_items_order_id_idx on public.invoice_items (order_id);
create unique index if not exists invoice_items_one_late_fee
  on public.invoice_items (invoice_id) where line_type = 'late_fee';

-- Never updated except for voiding, never deleted (SPEC §35.10).
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices (id) on delete restrict,
  amount numeric(12, 2) not null,
  paid_on date not null default ((now() at time zone 'America/Paramaribo')::date),
  method public.payment_method not null,
  reference text,
  received_amount numeric(12, 2),
  received_currency public.currency_code,
  customer_note text,
  recorded_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid,
  void_reason text,
  constraint payments_amount_check check (amount > 0),
  constraint payments_received_check check (
    (received_amount is null) = (received_currency is null) and received_amount > 0),
  constraint payments_voided_check check (
    (voided_at is null) = (void_reason is null)
    and (void_reason is null or btrim(void_reason) <> '')),
  constraint payments_text_lengths check (
    char_length(reference) <= 200 and char_length(customer_note) <= 2000 and char_length(void_reason) <= 500)
);

-- Leads with invoice_id for the foreign key; voided_at is part of the customer policy.
create index if not exists payments_invoice_id_idx on public.payments (invoice_id, voided_at);
create index if not exists payments_paid_on_idx on public.payments (paid_on);

-- Written only by server code with the service role (SPEC §35.2, §35.12).
-- Claim before sending: insert ... on conflict (idempotency_key) do nothing;
-- a 'failed' row may be claimed again by updating it back to 'queued'.
create table if not exists public.email_logs (
  id uuid primary key default gen_random_uuid(),
  kind public.email_kind not null,
  customer_id uuid references public.customers (id) on delete set null,
  invoice_id uuid references public.invoices (id) on delete set null,
  order_id uuid references public.orders (id) on delete set null,
  recipient text not null,
  idempotency_key text not null,
  status public.email_status not null default 'queued',
  provider_message_id text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  constraint email_logs_idempotency_key_key unique (idempotency_key),
  constraint email_logs_sent_check check ((status = 'sent') = (sent_at is not null)),
  constraint email_logs_recipient_check check (recipient ~ '@' and char_length(recipient) <= 320),
  constraint email_logs_text_lengths check (
    btrim(idempotency_key) <> '' and char_length(idempotency_key) <= 200
    and char_length(provider_message_id) <= 200 and char_length(error) <= 5000)
);

create index if not exists email_logs_customer_id_idx on public.email_logs (customer_id);
create index if not exists email_logs_invoice_id_idx on public.email_logs (invoice_id);
create index if not exists email_logs_order_id_idx on public.email_logs (order_id);
create index if not exists email_logs_created_at_idx on public.email_logs (created_at);
create index if not exists email_logs_status_idx on public.email_logs (status);

-- One row per run of a server job, e.g. the payment reminders (SPEC §35.12).
create table if not exists public.job_runs (
  id uuid primary key default gen_random_uuid(),
  job text not null,
  trigger public.job_trigger not null,
  status public.job_run_status not null default 'running',
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  started_by uuid,
  stats jsonb not null default '{}'::jsonb,
  error text,
  constraint job_runs_job_check check (job ~ '^[a-z][a-z0-9_]{1,49}$'),
  constraint job_runs_finished_check check (
    (status = 'running') = (finished_at is null) and (finished_at is null or finished_at >= started_at)),
  constraint job_runs_stats_check check (jsonb_typeof(stats) = 'object'),
  constraint job_runs_error_length check (char_length(error) <= 5000)
);

create index if not exists job_runs_job_started_at_idx on public.job_runs (job, started_at);

-- internal_notes.invoice_id / payment_id were created without foreign keys in
-- migration 2. A note outlives a deleted draft on its customer.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'internal_notes_invoice_id_fkey' and conrelid = 'public.internal_notes'::regclass
  ) then
    alter table public.internal_notes
      add constraint internal_notes_invoice_id_fkey
      foreign key (invoice_id) references public.invoices (id) on delete set null;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'internal_notes_payment_id_fkey' and conrelid = 'public.internal_notes'::regclass
  ) then
    alter table public.internal_notes
      add constraint internal_notes_payment_id_fkey
      foreign key (payment_id) references public.payments (id) on delete set null;
  end if;
end
$$;

-- ===========================================================================
-- Overview (SPEC §35.10): overdue is computed, never stored. Computed columns
-- come first so a later migration can append invoice columns with
-- create or replace view.
-- ===========================================================================

create or replace view public.invoice_overview
with (security_invoker = true)
as
select
  coalesce(p.amount_paid, 0)::numeric(12, 2) as amount_paid,
  b.balance_due,
  (i.status in ('open', 'partially_paid')
    and i.due_date < (now() at time zone 'America/Paramaribo')::date
    and b.balance_due > 0) as is_overdue,
  case
    when i.status in ('open', 'partially_paid')
     and i.due_date < (now() at time zone 'America/Paramaribo')::date
     and b.balance_due > 0
    then (now() at time zone 'America/Paramaribo')::date - i.due_date
    else 0
  end as days_overdue,
  i.*
from public.invoices i
left join lateral (
  select sum(pm.amount) as amount_paid
  from public.payments pm
  where pm.invoice_id = i.id and pm.voided_at is null
) p on true
cross join lateral (
  select case
    when i.status in ('draft', 'cancelled') then 0::numeric(12, 2)
    else greatest(i.total_amount - coalesce(p.amount_paid, 0), 0)::numeric(12, 2)
  end as balance_due
) b;

-- ===========================================================================
-- Private helpers
-- ===========================================================================

create or replace function private.invoice_amount_paid(_invoice_id uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(p.amount), 0)
  from public.payments p
  where p.invoice_id = _invoice_id and p.voided_at is null
$$;

-- Freezes the GR code (SPEC §35.5). Replaces migration 1's run-time lookup now
-- that both tables exist; a draft invoice does not count.
create or replace function private.customer_has_activity(_customer_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.orders o where o.customer_id = _customer_id)
      or exists (select 1 from public.invoices i where i.customer_id = _customer_id and i.status <> 'draft')
$$;

-- The customer and the invoice being corrected, for a draft's insert or edit.
create or replace function private.check_invoice_parties(
  _invoice_id uuid,
  _customer_id uuid,
  _replaces_invoice_id uuid,
  _signed_in boolean
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  _status public.customer_status;
  _replaced record;
begin
  select c.status into _status from public.customers c where c.id = _customer_id;
  if not found then
    raise exception 'Klant niet gevonden' using errcode = 'P0002';
  end if;
  if _signed_in and _status = 'disabled' then
    raise exception 'Deze klant is gedeactiveerd' using errcode = '55000';
  end if;
  if _replaces_invoice_id is not null then
    select i.customer_id, i.status into _replaced from public.invoices i where i.id = _replaces_invoice_id;
    if not found or _replaced.customer_id <> _customer_id or _replaced.status = 'draft' then
      raise exception 'De te vervangen factuur moet een uitgegeven factuur van dezelfde klant zijn'
        using errcode = '22023';
    end if;
  end if;
  if exists (
    select 1 from public.invoice_items li join public.orders o on o.id = li.order_id
    where li.invoice_id = _invoice_id and o.customer_id <> _customer_id
  ) then
    raise exception 'Deze factuur bevat orders van een andere klant; verwijder die regels eerst'
      using errcode = '22023';
  end if;
end
$$;

-- Keeps the invoice totals in step with its lines (formulas in the header).
-- Keeps an outer mutation flag (issue, late_fee) so its guard rules still apply.
create or replace function private.recompute_invoice_totals(_invoice_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  _rate numeric;
  _t record;
  _total numeric;
  _vat numeric;
  _prev text := coalesce(current_setting('app.invoice_mutation', true), '');
begin
  select i.vat_rate into _rate from public.invoices i where i.id = _invoice_id;
  if not found then
    return;  -- the draft itself is being deleted
  end if;

  select
    coalesce(sum(li.weight_lbs) filter (where li.line_type = 'freight'), 0) as total_lbs,
    coalesce(sum(li.amount) filter (where li.line_type = 'freight'), 0) as subtotal_freight,
    coalesce(sum(li.amount) filter (where li.line_type <> 'discount'), 0) as total_charges,
    coalesce(-sum(li.amount) filter (where li.line_type = 'discount'), 0) as total_discount,
    coalesce(sum(li.amount) filter (where not li.vat_exempt), 0) as vat_base
  into _t
  from public.invoice_items li
  where li.invoice_id = _invoice_id;

  _total := _t.total_charges - _t.total_discount;
  if _total < 0 then
    raise exception 'De korting is hoger dan de kosten: het totaal van een factuur kan niet negatief zijn'
      using errcode = '22023';
  end if;
  _vat := case when _rate is null then null else round(greatest(_t.vat_base, 0) * _rate / (100 + _rate), 2) end;

  if _prev = '' then
    perform set_config('app.invoice_mutation', 'totals', true);
  end if;
  update public.invoices i set
    total_lbs = _t.total_lbs,
    subtotal_freight = _t.subtotal_freight,
    total_charges = _t.total_charges,
    total_discount = _t.total_discount,
    total_amount = _total,
    vat_amount = _vat
  where i.id = _invoice_id
    and (i.total_lbs, i.subtotal_freight, i.total_charges, i.total_discount, i.total_amount, i.vat_amount)
        is distinct from (_t.total_lbs, _t.subtotal_freight, _t.total_charges, _t.total_discount, _total, _vat);
  perform set_config('app.invoice_mutation', _prev, true);
end
$$;

-- Payment-driven status (SPEC §35.10). Drafts and cancelled invoices keep theirs.
create or replace function private.derive_invoice_status(_invoice_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  _inv record;
  _paid numeric;
  _status public.invoice_status;
  _prev text;
begin
  select i.status, i.total_amount into _inv from public.invoices i where i.id = _invoice_id for no key update;
  if not found or _inv.status in ('draft', 'cancelled') then
    return;
  end if;
  _paid := private.invoice_amount_paid(_invoice_id);
  _status := case
    when _paid >= _inv.total_amount then 'paid'
    when _paid > 0 then 'partially_paid'
    else 'open'
  end;
  if _status is distinct from _inv.status then
    _prev := coalesce(current_setting('app.invoice_mutation', true), '');
    perform set_config('app.invoice_mutation', 'payment', true);
    update public.invoices i
       set status = _status, paid_at = case when _status = 'paid' then now() end
     where i.id = _invoice_id;
    perform set_config('app.invoice_mutation', _prev, true);
  end if;
end
$$;

-- SPEC §35.7: with pay_before_pickup on, an order on an issued invoice with a
-- balance cannot reach a completed stage, except via pickup_override. The hint
-- lets the app open its override dialog.
create or replace function private.assert_paid_before_pickup(_order_ids uuid[], _to_status text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  _blockers text;
begin
  if not exists (select 1 from public.shipment_statuses s where s.code = _to_status and s.stage = 'completed') then
    return;
  end if;
  if not coalesce((select s.pay_before_pickup from public.company_settings s where s.id), true) then
    return;
  end if;
  select string_agg(distinct format('%s (%s)', o.reference, i.invoice_number), ', ')
    into _blockers
  from public.orders o
  join public.invoice_items li on li.order_id = o.id
  join public.invoices i on i.id = li.invoice_id
  where o.id = any (_order_ids)
    and o.status is distinct from _to_status
    and i.status in ('open', 'partially_paid')
    and i.total_amount > private.invoice_amount_paid(i.id);
  if _blockers is not null then
    raise exception 'Nog niet betaald: %. Laat eerst betalen of geef af met een reden.', _blockers
      using errcode = '55000', hint = 'pay_before_pickup';
  end if;
end
$$;

-- ===========================================================================
-- Trigger functions
-- ===========================================================================

-- Every invoice starts as an empty draft; only drafts are edited or deleted.
-- After issue, only the RPCs change an invoice, each through its own flag.
create or replace function private.invoices_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid uuid := (select auth.uid());
  _mutation text := coalesce(current_setting('app.invoice_mutation', true), '');
  _totals constant text[] := array[
    'total_lbs', 'subtotal_freight', 'total_charges', 'total_discount', 'total_amount', 'vat_rate', 'vat_amount'];
  _draft_editable constant text[] := array[
    'customer_id', 'currency', 'invoice_date', 'due_date', 'customer_note', 'replaces_invoice_id'];
  _reminders constant text[] := array['first_reminder_sent_at', 'last_reminder_sent_at', 'reminder_count'];
  _settings record;
  _changed text[];
  _allowed text[];
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'Factuur % is uitgegeven en wordt nooit verwijderd; een beheerder kan hem annuleren',
        old.invoice_number using errcode = '55000';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    if _uid is not null then
      -- BEFORE triggers run ahead of the RLS check: deny first.
      if not public.is_staff() then
        raise exception 'Geen toegang' using errcode = '42501';
      end if;
      new.created_at := now();
      new.created_by := _uid;
      new.updated_by := _uid;
    end if;
    select s.vat_rate_percent, s.payment_term_days into _settings from public.company_settings s where s.id;
    new.status := 'draft';
    new.invoice_number := null;
    new.total_lbs := 0;
    new.subtotal_freight := 0;
    new.total_charges := 0;
    new.total_discount := 0;
    new.total_amount := 0;
    new.vat_rate := _settings.vat_rate_percent;
    new.vat_amount := case when new.vat_rate is null then null else 0 end;
    new.issuer_snapshot := null;
    new.bill_to_snapshot := null;
    new.issued_at := null;
    new.issued_by := null;
    new.paid_at := null;
    new.cancelled_at := null;
    new.cancelled_by := null;
    new.cancel_reason := null;
    new.first_reminder_sent_at := null;
    new.last_reminder_sent_at := null;
    new.reminder_count := 0;
    new.late_fee_applied_at := null;
    new.invoice_date := coalesce(new.invoice_date, (now() at time zone 'America/Paramaribo')::date);
    new.due_date := coalesce(new.due_date, new.invoice_date + _settings.payment_term_days);
    perform private.check_invoice_parties(new.id, new.customer_id, new.replaces_invoice_id, _uid is not null);
    return new;
  end if;

  select coalesce(array_agg(n.key), '{}') into _changed
  from jsonb_each(to_jsonb(new)) n
  where n.key not in ('updated_at', 'updated_by')
    and n.value is distinct from (to_jsonb(old) -> n.key);
  if cardinality(_changed) = 0 then
    return new;
  end if;

  if old.status = 'draft' then
    _allowed := _draft_editable || case _mutation
      when 'totals' then _totals
      when 'issue' then _totals || array[
        'status', 'invoice_number', 'issued_at', 'issued_by', 'issuer_snapshot', 'bill_to_snapshot']
      else '{}'::text[]
    end;
    if not _changed <@ _allowed then
      raise exception 'Geen toegang: status, nummer en totalen van een factuur wijzigen alleen via de factuuracties'
        using errcode = '42501';
    end if;
    if new.status not in ('draft', 'open') then
      raise exception 'Een concept wordt eerst uitgegeven' using errcode = '55000';
    end if;
    if new.customer_id is distinct from old.customer_id
       or new.replaces_invoice_id is distinct from old.replaces_invoice_id then
      perform private.check_invoice_parties(new.id, new.customer_id, new.replaces_invoice_id, _uid is not null);
    end if;
    return new;
  end if;

  _allowed := _reminders || case _mutation
    when 'payment' then array['status', 'paid_at']
    when 'cancel' then array['status', 'cancelled_at', 'cancelled_by', 'cancel_reason']
    when 'late_fee' then _totals || array['late_fee_applied_at']
    else '{}'::text[]
  end;
  if not _changed <@ _allowed
     or old.status = 'cancelled' and 'status' = any (_changed)
     or _mutation = 'payment' and new.status not in ('open', 'partially_paid', 'paid')
     or _mutation = 'cancel' and new.status <> 'cancelled' then
    raise exception 'Factuur % is uitgegeven en kan niet meer worden gewijzigd; corrigeer met annuleren en een nieuwe factuur',
      old.invoice_number using errcode = '55000';
  end if;
  return new;
end
$$;

-- Lines change only on drafts; the late fee is the single exception. Freight
-- is billed once per order across all invoices that are not cancelled.
create or replace function private.invoice_items_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid uuid := (select auth.uid());
  _mutation text := coalesce(current_setting('app.invoice_mutation', true), '');
  _inv record;
  _order record;
  _other text;
begin
  -- BEFORE triggers run ahead of the RLS check: deny first.
  if _uid is not null and not public.is_staff() then
    raise exception 'Geen toegang' using errcode = '42501';
  end if;

  -- An exclusive lock (not FOR SHARE, which two writers could both hold and
  -- then deadlock upgrading) serialises line changes with issue_invoice.
  select i.id, i.status, i.customer_id, i.invoice_number into _inv
  from public.invoices i
  where i.id = case when tg_op = 'DELETE' then old.invoice_id else new.invoice_id end
  for no key update;
  if not found then
    if tg_op = 'DELETE' then
      return old;  -- cascade from deleting the draft itself
    end if;
    raise exception 'Factuur niet gevonden' using errcode = 'P0002';
  end if;
  if tg_op = 'UPDATE' and new.invoice_id is distinct from old.invoice_id then
    raise exception 'Een factuurregel kan niet naar een andere factuur worden verplaatst' using errcode = '22023';
  end if;
  if _inv.status <> 'draft'
     and not (tg_op = 'INSERT' and _mutation = 'late_fee' and new.line_type = 'late_fee') then
    raise exception 'Factuur % is uitgegeven; de regels kunnen niet meer worden gewijzigd', _inv.invoice_number
      using errcode = '55000';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;

  if new.line_type = 'late_fee' and _mutation <> 'late_fee' then
    raise exception 'Geen toegang: de opslag voor te late betaling wordt alleen via "Opslag toepassen" berekend'
      using errcode = '42501';
  end if;

  new.vat_exempt := coalesce(new.vat_exempt, new.line_type = 'customs');
  if new.line_type = 'freight' then
    if new.weight_lbs is null or new.rate_per_lb is null then
      raise exception 'Een vrachtregel heeft een gewicht en een tarief per lb nodig' using errcode = '22023';
    end if;
    new.amount := round(new.weight_lbs * new.rate_per_lb, 2);
  end if;

  if new.order_id is not null
     and (tg_op = 'INSERT' or new.order_id is distinct from old.order_id or new.line_type is distinct from old.line_type) then
    -- The order row lock serialises the freight check across invoices.
    select o.reference, o.customer_id into _order
    from public.orders o where o.id = new.order_id
    for no key update;
    if not found or _order.customer_id <> _inv.customer_id then
      raise exception 'Deze order hoort niet bij de klant van de factuur' using errcode = '22023';
    end if;
    if new.line_type = 'freight' then
      select coalesce(i.invoice_number, 'een concept') into _other
      from public.invoice_items li join public.invoices i on i.id = li.invoice_id
      where li.order_id = new.order_id and li.line_type = 'freight' and i.status <> 'cancelled' and li.id <> new.id
      limit 1;
      if found then
        raise exception 'De vracht van order % staat al op %', _order.reference, _other using errcode = '23505';
      end if;
    end if;
  end if;

  if tg_op = 'INSERT' then
    if _uid is not null then
      new.created_at := now();
      new.created_by := _uid;
      new.updated_by := _uid;
    end if;
  else
    new.created_at := old.created_at;
    new.created_by := old.created_by;
  end if;
  return new;
end
$$;

create or replace function private.invoice_items_recompute()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.recompute_invoice_totals(case when tg_op = 'DELETE' then old.invoice_id else new.invoice_id end);
  return null;
end
$$;

-- Payments go in through record_payment and change only by void_payment.
create or replace function private.payments_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid uuid := (select auth.uid());
  _inv record;
  _balance numeric;
begin
  if tg_op = 'DELETE' then
    raise exception 'Een betaling wordt nooit verwijderd; een beheerder kan hem ongedaan maken' using errcode = '55000';
  end if;

  if tg_op = 'UPDATE' then
    if coalesce(current_setting('app.payment_mutation', true), '') <> 'void'
       or old.voided_at is not null
       or (to_jsonb(new) - array['voided_at', 'voided_by', 'void_reason'])
          is distinct from (to_jsonb(old) - array['voided_at', 'voided_by', 'void_reason']) then
      raise exception 'Een betaling wordt nooit gewijzigd; een beheerder kan hem ongedaan maken' using errcode = '55000';
    end if;
    return new;
  end if;

  -- Locked like derive_invoice_status does, so concurrent payments queue up.
  select i.status, i.currency, i.total_amount, i.invoice_number into _inv
  from public.invoices i where i.id = new.invoice_id for no key update;
  if not found then
    raise exception 'Factuur niet gevonden' using errcode = 'P0002';
  end if;
  if _inv.status = 'draft' then
    raise exception 'Een concept kan niet worden betaald; geef de factuur eerst uit' using errcode = '55000';
  end if;
  if _inv.status = 'cancelled' then
    raise exception 'Factuur % is geannuleerd en kan niet worden betaald', _inv.invoice_number using errcode = '55000';
  end if;
  if _inv.status = 'paid' then
    raise exception 'Factuur % is al volledig betaald', _inv.invoice_number using errcode = '55000';
  end if;
  if new.amount is null or new.amount <= 0 then
    raise exception 'Vul een bedrag groter dan 0 in' using errcode = '22023';
  end if;
  _balance := _inv.total_amount - private.invoice_amount_paid(new.invoice_id);
  if new.amount > _balance then
    raise exception 'Het bedrag is hoger dan het openstaande saldo (% %)', _inv.currency, _balance using errcode = '22023';
  end if;
  new.paid_on := coalesce(new.paid_on, (now() at time zone 'America/Paramaribo')::date);
  if new.paid_on > (now() at time zone 'America/Paramaribo')::date then
    raise exception 'De betaaldatum ligt in de toekomst' using errcode = '22023';
  end if;
  new.recorded_by := coalesce(_uid, new.recorded_by);
  new.created_at := now();
  new.voided_at := null;
  new.voided_by := null;
  new.void_reason := null;
  return new;
end
$$;

create or replace function private.payments_derive_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.derive_invoice_status(new.invoice_id);
  return null;
end
$$;

-- Lines point at orders of the invoice's customer, so that customer is fixed
-- once an order is on an invoice (clients cannot change it at all).
create or replace function private.orders_invoiced_customer_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.invoice_items li where li.order_id = old.id) then
    raise exception 'Order % staat op een factuur; de klant van de order kan niet meer worden gewijzigd', old.reference
      using errcode = '55000';
  end if;
  return new;
end
$$;

-- Migration 2's version, plus: an invoice or payment note belongs to the same customer.
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
  if new.invoice_id is not null and not exists (
    select 1 from public.invoices i where i.id = new.invoice_id and i.customer_id = new.customer_id
  ) then
    raise exception 'Deze factuur hoort niet bij deze klant' using errcode = '22023';
  end if;
  if new.payment_id is not null and not exists (
    select 1 from public.payments p join public.invoices i on i.id = p.invoice_id
    where p.id = new.payment_id and i.customer_id = new.customer_id
  ) then
    raise exception 'Deze betaling hoort niet bij deze klant' using errcode = '22023';
  end if;
  return new;
end
$$;

-- ===========================================================================
-- Triggers
-- ===========================================================================

drop trigger if exists invoice_number_counters_touch_updated_at on public.invoice_number_counters;
create trigger invoice_number_counters_touch_updated_at
  before update on public.invoice_number_counters
  for each row execute function private.touch_updated_at();

-- Fires before invoices_touch_updated_at (trigger names sort alphabetically).
drop trigger if exists invoices_guard on public.invoices;
create trigger invoices_guard
  before insert or update or delete on public.invoices
  for each row execute function private.invoices_guard();

drop trigger if exists invoices_touch_updated_at on public.invoices;
create trigger invoices_touch_updated_at
  before update on public.invoices
  for each row execute function private.touch_updated_at();

drop trigger if exists invoices_audit on public.invoices;
create trigger invoices_audit
  after insert or update or delete on public.invoices
  for each row execute function private.audit_row();

drop trigger if exists invoice_items_guard on public.invoice_items;
create trigger invoice_items_guard
  before insert or update or delete on public.invoice_items
  for each row execute function private.invoice_items_guard();

drop trigger if exists invoice_items_touch_updated_at on public.invoice_items;
create trigger invoice_items_touch_updated_at
  before update on public.invoice_items
  for each row execute function private.touch_updated_at();

drop trigger if exists invoice_items_recompute on public.invoice_items;
create trigger invoice_items_recompute
  after insert or update or delete on public.invoice_items
  for each row execute function private.invoice_items_recompute();

drop trigger if exists invoice_items_audit on public.invoice_items;
create trigger invoice_items_audit
  after insert or update or delete on public.invoice_items
  for each row execute function private.audit_row();

drop trigger if exists payments_guard on public.payments;
create trigger payments_guard
  before insert or update or delete on public.payments
  for each row execute function private.payments_guard();

drop trigger if exists payments_derive_status on public.payments;
create trigger payments_derive_status
  after insert or update of voided_at on public.payments
  for each row execute function private.payments_derive_status();

drop trigger if exists payments_audit on public.payments;
create trigger payments_audit
  after insert or update or delete on public.payments
  for each row execute function private.audit_row();

drop trigger if exists email_logs_touch_updated_at on public.email_logs;
create trigger email_logs_touch_updated_at
  before update on public.email_logs
  for each row execute function private.touch_updated_at();

drop trigger if exists orders_invoiced_customer_guard on public.orders;
create trigger orders_invoiced_customer_guard
  before update of customer_id on public.orders
  for each row when (old.customer_id is distinct from new.customer_id)
  execute function private.orders_invoiced_customer_guard();

-- ===========================================================================
-- RPCs for signed-in users. Each starts with its access guard (SPEC §35.3).
-- ===========================================================================

-- "Genereer factuur" (SPEC §35.9): number, totals and snapshots in one
-- transaction. The year of the number is the year of invoice_date.
--
-- A draft keeps the dates it was saved with, so issuing checks them against
-- today in Suriname: an invoice is never overdue the moment it is issued, and
-- numbers of a year are only handed out during that year (a December draft
-- issued in January, or a future date, would otherwise take a number from
-- another year's series). The hint lets the builder offer "Datums bijwerken".
create or replace function public.issue_invoice(_invoice_id uuid)
returns public.invoices
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  _uid uuid := (select auth.uid());
  _today date := (now() at time zone 'America/Paramaribo')::date;
  _inv public.invoices;
  _s public.company_settings;
  _c public.customers;
  _year integer;
  _n integer;
  _number text;
  _issuer jsonb;
  _bill_to jsonb;
begin
  if not (select public.is_staff()) then
    raise exception 'Geen toegang' using errcode = '42501';
  end if;

  select * into _inv from public.invoices i where i.id = _invoice_id for update;
  if not found then
    raise exception 'Factuur niet gevonden' using errcode = 'P0002';
  end if;
  if _inv.status <> 'draft' then
    raise exception 'Factuur % is al uitgegeven', _inv.invoice_number using errcode = '55000';
  end if;
  if _inv.invoice_date > _today then
    raise exception 'De factuurdatum (%) ligt in de toekomst; een factuur wordt uitgegeven op de factuurdatum',
      to_char(_inv.invoice_date, 'DD-MM-YYYY') using errcode = '55000', hint = 'invoice_dates';
  end if;
  if extract(year from _inv.invoice_date) <> extract(year from _today) then
    raise exception 'De factuurdatum (%) ligt in een vorig jaar; kies een factuurdatum in %',
      to_char(_inv.invoice_date, 'DD-MM-YYYY'), extract(year from _today)
      using errcode = '55000', hint = 'invoice_dates';
  end if;
  if _inv.due_date < _today then
    raise exception 'De vervaldatum (%) is al verstreken; kies een vervaldatum vanaf vandaag',
      to_char(_inv.due_date, 'DD-MM-YYYY') using errcode = '55000', hint = 'invoice_dates';
  end if;
  if not exists (select 1 from public.invoice_items li where li.invoice_id = _inv.id) then
    raise exception 'Een factuur heeft minstens één regel nodig' using errcode = '22023';
  end if;
  select * into _c from public.customers c where c.id = _inv.customer_id;
  if _c.status = 'disabled' then
    raise exception 'Deze klant is gedeactiveerd' using errcode = '55000';
  end if;
  if _inv.replaces_invoice_id is not null and not exists (
    select 1 from public.invoices r where r.id = _inv.replaces_invoice_id and r.status = 'cancelled'
  ) then
    raise exception 'Annuleer eerst de factuur die deze factuur vervangt' using errcode = '55000';
  end if;
  select * into _s from public.company_settings s where s.id;

  perform set_config('app.invoice_mutation', 'issue', true);
  -- Drafts follow the live VAT setting; the issued invoice keeps today's.
  update public.invoices i
     set vat_rate = _s.vat_rate_percent,
         vat_amount = case when _s.vat_rate_percent is null then null else coalesce(i.vat_amount, 0) end
   where i.id = _inv.id;
  perform private.recompute_invoice_totals(_inv.id);
  select * into _inv from public.invoices i where i.id = _inv.id;
  if _inv.total_amount <= 0 then
    raise exception 'Het totaal van de factuur moet groter dan 0 zijn' using errcode = '22023';
  end if;

  _year := extract(year from _inv.invoice_date)::integer;
  insert into public.invoice_number_counters as c (year, last_number)
  values (_year, 1)
  on conflict (year) do update set last_number = c.last_number + 1
  returning c.last_number into _n;
  -- lpad would truncate: from 10000 on the number simply gets more digits.
  _number := coalesce(_s.invoice_number_prefix, '') || _year::text || '-'
    || case when _n > 9999 then _n::text else lpad(_n::text, 4, '0') end;

  _issuer := jsonb_build_object(
    'version', 1,
    'company_name', _s.company_name,
    'tagline', _s.tagline,
    'email', _s.email,
    'phone', _s.phone,
    'address', _s.address,
    'kkf_number', _s.kkf_number,
    'btw_number', _s.btw_number,
    'invoice_title', _s.invoice_title,
    'footer_text', _s.footer_text,
    'payment_terms_text', _s.payment_terms_text,
    'payment_term_days', _s.payment_term_days,
    'late_fee_percent', _s.late_fee_percent,
    'vat_rate_percent', _s.vat_rate_percent,
    'show_vat_breakdown', _s.show_vat_breakdown,
    'paper_size', _s.paper_size,
    'bank_accounts', coalesce((
      select jsonb_agg(jsonb_build_object(
               'currency', b.currency, 'bank_name', b.bank_name,
               'account_holder', b.account_holder, 'account_number', b.account_number)
             order by b.sort_order, b.currency)
      from public.company_bank_accounts b where b.is_active), '[]'::jsonb));

  _bill_to := jsonb_build_object(
    'version', 1,
    'customer_id', _c.id,
    'customer_code', _c.customer_code,
    'full_name', _c.full_name,
    'account_type', _c.account_type,
    'company_name', _c.company_name,
    'kkf_number', _c.kkf_number,
    'contact_person', _c.contact_person,
    'address', _c.address,
    'district', _c.district,
    'email', _c.email,
    'phone', _c.phone,
    -- "Referentie:" and the tracking lines print from here, not from live orders.
    'orders', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', o.id, 'reference', o.reference, 'tracking_number', o.tracking_number,
               'store_vendor', o.store_vendor, 'vendor_order_number', o.vendor_order_number)
             order by o.reference)
      from public.orders o
      where o.id in (select li.order_id from public.invoice_items li where li.invoice_id = _inv.id)), '[]'::jsonb));

  update public.invoices i set
    status = 'open',
    invoice_number = _number,
    issued_at = now(),
    issued_by = _uid,
    issuer_snapshot = _issuer,
    bill_to_snapshot = _bill_to
  where i.id = _inv.id
  returning * into _inv;
  perform set_config('app.invoice_mutation', '', true);
  return _inv;
end
$$;

-- Lets G&R continue its existing numbering (SPEC §35.9), but never once a
-- number of that year has been handed out.
create or replace function public.set_invoice_counter(_year integer, _last_number integer)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  _old integer;
begin
  if not (select public.is_admin()) then
    raise exception 'Geen toegang' using errcode = '42501';
  end if;
  if _year is null or _year not between 2000 and 2999 then
    raise exception 'Kies een jaar tussen 2000 en 2999' using errcode = '22023';
  end if;
  if _last_number is null or _last_number not between 0 and 99999999 then
    raise exception 'Het laatst gebruikte nummer moet 0 of hoger zijn' using errcode = '22023';
  end if;
  -- Lock first, so an issue running right now cannot slip between check and write.
  select c.last_number into _old from public.invoice_number_counters c where c.year = _year for update;
  if exists (
    select 1 from public.invoices i
    where i.invoice_number is not null and extract(year from i.invoice_date) = _year
  ) then
    raise exception 'In % is al een factuur uitgegeven; de nummering kan niet meer worden aangepast', _year
      using errcode = '55000';
  end if;

  insert into public.invoice_number_counters as c (year, last_number)
  values (_year, _last_number)
  on conflict (year) do update set last_number = excluded.last_number;
  insert into public.audit_log (actor_id, table_name, record_id, action, old_data, new_data, changed_columns)
  values ((select auth.uid()), 'invoice_number_counters', _year::text, case when _old is null then 'INSERT' else 'UPDATE' end,
          case when _old is null then null else jsonb_build_object('year', _year, 'last_number', _old) end,
          jsonb_build_object('year', _year, 'last_number', _last_number),
          case when _old is null then null else array['last_number'] end);
  return _last_number;
end
$$;

-- Admin only, with a reason the customer sees (SPEC §35.9). Payments must be
-- voided first, so a cancelled invoice never holds money.
create or replace function public.cancel_invoice(_invoice_id uuid, _reason text)
returns public.invoices
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  _inv public.invoices;
  _why text := left(nullif(btrim(_reason), ''), 500);
begin
  if not (select public.is_admin()) then
    raise exception 'Geen toegang' using errcode = '42501';
  end if;
  if _why is null then
    raise exception 'Een reden is verplicht' using errcode = '22023';
  end if;
  select * into _inv from public.invoices i where i.id = _invoice_id for update;
  if not found then
    raise exception 'Factuur niet gevonden' using errcode = 'P0002';
  end if;
  if _inv.status = 'draft' then
    raise exception 'Een concept wordt niet geannuleerd maar verwijderd' using errcode = '55000';
  end if;
  if _inv.status = 'cancelled' then
    raise exception 'Factuur % is al geannuleerd', _inv.invoice_number using errcode = '55000';
  end if;
  if private.invoice_amount_paid(_inv.id) > 0 then
    raise exception 'Op factuur % staan betalingen; maak die eerst ongedaan', _inv.invoice_number
      using errcode = '55000';
  end if;

  perform set_config('app.invoice_mutation', 'cancel', true);
  perform set_config('app.audit_reason', _why, true);
  update public.invoices i set
    status = 'cancelled',
    cancelled_at = now(),
    cancelled_by = (select auth.uid()),
    cancel_reason = _why
  where i.id = _inv.id
  returning * into _inv;
  perform set_config('app.audit_reason', '', true);
  perform set_config('app.invoice_mutation', '', true);
  return _inv;
end
$$;

-- Staff record a payment; a null amount pays the full balance ("Markeer als
-- betaald"). The caller e-mails "betaling ontvangen" when invoice_status is 'paid'.
create or replace function public.record_payment(
  _invoice_id uuid,
  _amount numeric default null,
  _paid_on date default null,
  _method public.payment_method default 'bank_transfer',
  _reference text default null,
  _received_amount numeric default null,
  _received_currency public.currency_code default null,
  _customer_note text default null
)
returns table (payment_id uuid, invoice_status public.invoice_status, amount_paid numeric, balance_due numeric)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  _inv record;
  _pid uuid;
begin
  if not (select public.is_staff()) then
    raise exception 'Geen toegang' using errcode = '42501';
  end if;
  select i.id, i.total_amount into _inv from public.invoices i where i.id = _invoice_id for no key update;
  if not found then
    raise exception 'Factuur niet gevonden' using errcode = 'P0002';
  end if;

  insert into public.payments as p (
    invoice_id, amount, paid_on, method, reference, received_amount, received_currency, customer_note
  ) values (
    _inv.id,
    coalesce(round(_amount, 2), _inv.total_amount - private.invoice_amount_paid(_inv.id)),
    _paid_on,
    coalesce(_method, 'bank_transfer'),
    nullif(btrim(_reference), ''),
    round(_received_amount, 2),
    _received_currency,
    nullif(btrim(_customer_note), '')
  )
  returning p.id into _pid;

  return query
    select _pid, v.status, v.amount_paid, v.balance_due
    from public.invoice_overview v where v.id = _inv.id;
end
$$;

-- Admin only, with a reason (SPEC §35.10); the invoice status follows.
create or replace function public.void_payment(_payment_id uuid, _reason text)
returns table (payment_id uuid, invoice_status public.invoice_status, amount_paid numeric, balance_due numeric)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  _why text := left(nullif(btrim(_reason), ''), 500);
  _invoice_id uuid;
  _status public.invoice_status;
  _voided timestamptz;
begin
  if not (select public.is_admin()) then
    raise exception 'Geen toegang' using errcode = '42501';
  end if;
  if _why is null then
    raise exception 'Een reden is verplicht' using errcode = '22023';
  end if;
  select p.invoice_id into _invoice_id from public.payments p where p.id = _payment_id;
  if not found then
    raise exception 'Betaling niet gevonden' using errcode = 'P0002';
  end if;
  -- Invoice before payment: the same lock order as record_payment.
  select i.status into _status from public.invoices i where i.id = _invoice_id for no key update;
  select p.voided_at into _voided from public.payments p where p.id = _payment_id for update;
  if _voided is not null then
    raise exception 'Deze betaling is al ongedaan gemaakt' using errcode = '55000';
  end if;
  if _status = 'cancelled' then
    raise exception 'De factuur van deze betaling is geannuleerd' using errcode = '55000';
  end if;

  perform set_config('app.payment_mutation', 'void', true);
  perform set_config('app.audit_reason', _why, true);
  update public.payments p
     set voided_at = now(), voided_by = (select auth.uid()), void_reason = _why
   where p.id = _payment_id;
  perform set_config('app.audit_reason', '', true);
  perform set_config('app.payment_mutation', '', true);

  return query
    select _payment_id, v.status, v.amount_paid, v.balance_due
    from public.invoice_overview v where v.id = _invoice_id;
end
$$;

-- "Opslag 15% toepassen" (SPEC §35.10): admin only, once, and only while the
-- invoice is overdue. One late_fee line = round(balance * late_fee_percent / 100, 2),
-- with the percentage printed in the invoice's own terms (issuer_snapshot),
-- not today's setting (SPEC §35.9: issued invoices follow their snapshots).
create or replace function public.apply_late_fee(_invoice_id uuid)
returns public.invoices
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  _inv public.invoices;
  _pct numeric;
  _balance numeric;
  _fee numeric;
  _label text;
begin
  if not (select public.is_admin()) then
    raise exception 'Geen toegang' using errcode = '42501';
  end if;
  select * into _inv from public.invoices i where i.id = _invoice_id for update;
  if not found then
    raise exception 'Factuur niet gevonden' using errcode = 'P0002';
  end if;
  if _inv.late_fee_applied_at is not null
     or exists (select 1 from public.invoice_items li where li.invoice_id = _inv.id and li.line_type = 'late_fee') then
    raise exception 'Op factuur % is de opslag al toegepast', _inv.invoice_number using errcode = '55000';
  end if;
  _balance := _inv.total_amount - private.invoice_amount_paid(_inv.id);
  if _inv.status not in ('open', 'partially_paid')
     or _inv.due_date >= (now() at time zone 'America/Paramaribo')::date
     or _balance <= 0 then
    raise exception 'Factuur % is niet achterstallig; de opslag kan alleen na de vervaldatum worden toegepast',
      coalesce(_inv.invoice_number, '(concept)') using errcode = '55000';
  end if;
  _pct := coalesce(
    (_inv.issuer_snapshot ->> 'late_fee_percent')::numeric,
    (select s.late_fee_percent from public.company_settings s where s.id));
  _fee := round(_balance * _pct / 100, 2);
  if _fee <= 0 then
    raise exception 'De opslag zou 0 zijn; controleer het opslagpercentage bij Instellingen' using errcode = '22023';
  end if;
  _label := 'Opslag te late betaling (' || replace(trim_scale(_pct)::text, '.', ',') || '%)';

  perform set_config('app.invoice_mutation', 'late_fee', true);
  perform set_config('app.audit_reason', _label, true);
  insert into public.invoice_items (invoice_id, line_type, description, amount, vat_exempt, sort_order)
  values (_inv.id, 'late_fee', _label, _fee, true,
          (select coalesce(max(li.sort_order), 0) + 1 from public.invoice_items li where li.invoice_id = _inv.id));
  update public.invoices i set late_fee_applied_at = now() where i.id = _inv.id returning * into _inv;
  perform set_config('app.audit_reason', '', true);
  perform set_config('app.invoice_mutation', '', true);
  return _inv;
end
$$;

-- Migration 2's status change, now refusing pickup of unpaid orders (SPEC §35.7).
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
  perform private.assert_paid_before_pickup(_order_ids, _to_status);
  return query
    select a.o_order_id, a.o_history_id, a.o_customer_id, a.o_notify
    from private.apply_order_status(_order_ids, _to_status, _customer_message, _picked_up_by_name) a;
end
$$;

-- "Toch afgeven": hand over unpaid orders anyway, with a reason that lands in
-- the audit log of every order changed (SPEC §35.7).
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
  perform set_config('app.audit_reason', 'Afgegeven zonder volledige betaling: ' || _why, true);
  return query
    select a.o_order_id, a.o_history_id, a.o_customer_id, a.o_notify
    from private.apply_order_status(_order_ids, _to_status, _customer_message, _picked_up_by_name) a;
  perform set_config('app.audit_reason', '', true);
end
$$;

-- Per-year counts for the history page (SPEC §20, §35.15). SECURITY INVOKER:
-- the caller's RLS applies on top of the explicit customer filter. Staff pass
-- the customer; customers get their own record.
create or replace function public.customer_history_by_year(_customer_id uuid default null)
returns table (year integer, order_count bigint, shipment_count bigint, invoice_count bigint, payment_count bigint)
language plpgsql
stable
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  _staff boolean := (select public.is_staff());
  _own uuid := (select public.current_customer_id());
  _cid uuid;
begin
  if not _staff and (_own is null or coalesce(_customer_id <> _own, false)) then
    raise exception 'Geen toegang' using errcode = '42501';
  end if;
  _cid := case when _staff then _customer_id else _own end;
  if _cid is null then
    raise exception 'Kies een klant' using errcode = '22023';
  end if;

  return query
    with events as (
      select extract(year from (o.created_at at time zone 'America/Paramaribo'))::integer as y, 'order' as k, o.id as ref
        from public.orders o
       where o.customer_id = _cid
      union all
      select extract(year from (coalesce(s.departed_at, s.created_at) at time zone 'America/Paramaribo'))::integer,
             'shipment', s.id
        from public.orders o join public.shipments s on s.id = o.shipment_id
       where o.customer_id = _cid
      union all
      select extract(year from i.invoice_date)::integer, 'invoice', i.id
        from public.invoices i
       where i.customer_id = _cid and i.status not in ('draft', 'cancelled')
      union all
      select extract(year from p.paid_on)::integer, 'payment', p.id
        from public.payments p join public.invoices i on i.id = p.invoice_id
       where i.customer_id = _cid and i.status <> 'draft' and p.voided_at is null
    )
    select e.y,
           count(*) filter (where e.k = 'order'),
           count(distinct e.ref) filter (where e.k = 'shipment'),
           count(*) filter (where e.k = 'invoice'),
           count(*) filter (where e.k = 'payment')
      from events e
     group by e.y
     order by e.y desc;
end
$$;

-- ===========================================================================
-- Row level security: one policy per command, all to authenticated. Customers
-- see their invoices once issued, with lines and non-voided payments; a
-- disabled customer has no current_customer_id() and sees nothing.
-- ===========================================================================

alter table public.invoice_number_counters enable row level security;
alter table public.invoices enable row level security;
alter table public.invoice_items enable row level security;
alter table public.payments enable row level security;
alter table public.email_logs enable row level security;
alter table public.job_runs enable row level security;

drop policy if exists invoice_number_counters_select on public.invoice_number_counters;
create policy invoice_number_counters_select on public.invoice_number_counters
  for select to authenticated
  using ((select public.is_admin()));

drop policy if exists invoices_select on public.invoices;
create policy invoices_select on public.invoices
  for select to authenticated
  using (
    (customer_id = (select public.current_customer_id()) and status <> 'draft')
    or (select public.is_staff())
  );

drop policy if exists invoices_insert on public.invoices;
create policy invoices_insert on public.invoices
  for insert to authenticated
  with check ((select public.is_staff()));

-- Draft-only is enforced by invoices_guard, so a change to an issued invoice
-- raises instead of silently matching no rows.
drop policy if exists invoices_update on public.invoices;
create policy invoices_update on public.invoices
  for update to authenticated
  using ((select public.is_staff()))
  with check ((select public.is_staff()));

drop policy if exists invoices_delete on public.invoices;
create policy invoices_delete on public.invoices
  for delete to authenticated
  using ((select public.is_staff()));

drop policy if exists invoice_items_select on public.invoice_items;
create policy invoice_items_select on public.invoice_items
  for select to authenticated
  using (
    (select public.is_staff())
    or exists (
      select 1 from public.invoices i
      where i.id = invoice_items.invoice_id
        and i.customer_id = (select public.current_customer_id())
        and i.status <> 'draft'
    )
  );

drop policy if exists invoice_items_insert on public.invoice_items;
create policy invoice_items_insert on public.invoice_items
  for insert to authenticated
  with check ((select public.is_staff()));

drop policy if exists invoice_items_update on public.invoice_items;
create policy invoice_items_update on public.invoice_items
  for update to authenticated
  using ((select public.is_staff()))
  with check ((select public.is_staff()));

drop policy if exists invoice_items_delete on public.invoice_items;
create policy invoice_items_delete on public.invoice_items
  for delete to authenticated
  using ((select public.is_staff()));

-- Voided payments stay staff-only: void_reason is internal text.
drop policy if exists payments_select on public.payments;
create policy payments_select on public.payments
  for select to authenticated
  using (
    (select public.is_staff())
    or (
      voided_at is null
      and exists (
        select 1 from public.invoices i
        where i.id = payments.invoice_id
          and i.customer_id = (select public.current_customer_id())
          and i.status <> 'draft'
      )
    )
  );

drop policy if exists email_logs_select on public.email_logs;
create policy email_logs_select on public.email_logs
  for select to authenticated
  using ((select public.is_staff()));

drop policy if exists job_runs_select on public.job_runs;
create policy job_runs_select on public.job_runs
  for select to authenticated
  using ((select public.is_staff()));

-- ===========================================================================
-- Grants. Column lists keep status, number, totals, snapshots and authorship
-- out of every client's reach; payments, the counter, e-mail logs and job runs
-- have no client write grant at all.
-- ===========================================================================

revoke all on table
  public.invoice_number_counters, public.invoices, public.invoice_items, public.payments,
  public.email_logs, public.job_runs, public.invoice_overview
from anon, authenticated, service_role;

grant select on public.invoice_number_counters to authenticated;

grant select, delete on public.invoices to authenticated;
grant insert (customer_id, currency, invoice_date, due_date, customer_note, replaces_invoice_id)
  on public.invoices to authenticated;
grant update (customer_id, currency, invoice_date, due_date, customer_note, replaces_invoice_id)
  on public.invoices to authenticated;

grant select, delete on public.invoice_items to authenticated;
grant insert (invoice_id, order_id, line_type, description, weight_lbs, rate_per_lb, amount, vat_exempt, sort_order)
  on public.invoice_items to authenticated;
grant update (order_id, line_type, description, weight_lbs, rate_per_lb, amount, vat_exempt, sort_order)
  on public.invoice_items to authenticated;

grant select on public.payments to authenticated;
grant select on public.email_logs to authenticated;
grant select on public.job_runs to authenticated;
grant select on public.invoice_overview to authenticated;

grant insert (invoice_id, payment_id) on public.internal_notes to authenticated;

-- Server code: e-mails and the reminder job (SPEC §35.2, §35.12).
grant select on public.invoices to service_role;
grant update (first_reminder_sent_at, last_reminder_sent_at, reminder_count) on public.invoices to service_role;
grant select on public.invoice_items to service_role;
grant select on public.payments to service_role;
grant select on public.invoice_overview to service_role;
grant select, insert, update on public.email_logs to service_role;
grant select, insert, update on public.job_runs to service_role;

revoke all on function
  public.issue_invoice(uuid),
  public.set_invoice_counter(integer, integer),
  public.cancel_invoice(uuid, text),
  public.record_payment(uuid, numeric, date, public.payment_method, text, numeric, public.currency_code, text),
  public.void_payment(uuid, text),
  public.apply_late_fee(uuid),
  public.change_order_status(uuid[], text, text, text),
  public.pickup_override(uuid[], text, text, text, text),
  public.customer_history_by_year(uuid)
from public, anon, authenticated, service_role;

grant execute on function
  public.issue_invoice(uuid),
  public.set_invoice_counter(integer, integer),
  public.cancel_invoice(uuid, text),
  public.record_payment(uuid, numeric, date, public.payment_method, text, numeric, public.currency_code, text),
  public.void_payment(uuid, text),
  public.apply_late_fee(uuid),
  public.change_order_status(uuid[], text, text, text),
  public.pickup_override(uuid[], text, text, text, text),
  public.customer_history_by_year(uuid)
to authenticated;

revoke all on function
  private.invoice_amount_paid(uuid),
  private.customer_has_activity(uuid),
  private.check_invoice_parties(uuid, uuid, uuid, boolean),
  private.recompute_invoice_totals(uuid),
  private.derive_invoice_status(uuid),
  private.assert_paid_before_pickup(uuid[], text),
  private.invoices_guard(),
  private.invoice_items_guard(),
  private.invoice_items_recompute(),
  private.payments_guard(),
  private.payments_derive_status(),
  private.orders_invoiced_customer_guard(),
  private.internal_notes_stamp()
from public, anon, authenticated, service_role;
