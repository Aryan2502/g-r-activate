-- P10 review (whole-app audit; docs/PROGRESS.md "Bewijs P10 reviewronde").
--
-- 1. Uploads per customer are capped. Sign-up is public and the bucket takes
--    10 MB per file, so one account could store files without limit (the
--    orphan clean-up removes at most 500 per day and never touches recorded
--    files). For callers who are not staff:
--      * at most 20 files in the folder of one order (recorded or not), and
--      * at most 40 new files in all of the customer's folders per rolling
--        24 hours.
--    The storage policy refuses the upload (can_upload_order_object), and
--    order_documents_before_insert refuses a 21st document row for an order
--    with a Dutch message (54000). Staff are not limited. Parallel uploads can
--    pass a limit by the number of requests in flight; that is accepted, the
--    point is that storage stays bounded.
-- 2. has_role() answers a signed-in customer only about their own login.
--    Staff ids are in customer-readable columns (received_by, changed_by, …);
--    has_role(<that id>, 'admin') told the customer which login is an
--    administrator. Staff and callers without a login (service role, SQL
--    editor, cron, triggers run by the database itself) still get the real
--    answer, so get_invitation, redeem_invitation and the invitation triggers
--    are unchanged.
-- 3. log_recovery_link(): "Wachtwoord-resetlink maken" (customers: staff;
--    team members: admins) writes an audit_log row BEFORE the server creates
--    the link, and the server aborts when that fails. Until now the only trace
--    was an internal note written afterwards, whose failure was ignored.
-- 4. internal_notes joins the audited tables (generic audit trigger), so an
--    edited or deleted note leaves its old text in audit_log.
--
-- Idempotent (create or replace / drop … if exists). No table or column
-- changes, so the generated types change only by the new RPC.

-- ===========================================================================
-- 1. Upload limits
-- ===========================================================================

-- Same signature and grants as in 20261007090000_order_hardening.sql, so the
-- storage policy order_documents_objects_insert keeps calling it.
create or replace function public.can_upload_order_object(_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  _max_per_order constant integer := 20;
  _max_per_day constant integer := 40;
  _folder text[] := storage.foldername(_name);
  _order record;
begin
  if coalesce(array_length(_folder, 1), 0) <> 2 then
    return false;
  end if;
  select o.customer_id, s.stage into _order
  from public.orders o
  join public.shipment_statuses s on s.code = o.status
  where o.id::text = _folder[2]
    and o.customer_id::text = _folder[1];
  if not found then
    return false;
  end if;
  if (select public.is_staff()) then
    return true;
  end if;
  if _order.customer_id is distinct from (select public.current_customer_id())
     or _order.stage in ('completed', 'cancelled') then
    return false;
  end if;
  if (select count(*) from storage.objects so
      where so.bucket_id = 'order-documents'
        and starts_with(so.name, _folder[1] || '/' || _folder[2] || '/')) >= _max_per_order then
    return false;
  end if;
  if (select count(*) from storage.objects so
      where so.bucket_id = 'order-documents'
        and starts_with(so.name, _folder[1] || '/')
        and so.created_at > now() - interval '24 hours') >= _max_per_day then
    return false;
  end if;
  return true;
end
$$;

revoke all on function public.can_upload_order_object(text) from public, anon, authenticated, service_role;
grant execute on function public.can_upload_order_object(text) to authenticated;

-- As in 20261006190100_operations.sql, plus the per-order cap for customers.
create or replace function private.order_documents_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  _max_per_order constant integer := 20;
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
      if (select count(*) from public.order_documents d where d.order_id = new.order_id) >= _max_per_order then
        raise exception 'U kunt maximaal % documenten bij één order toevoegen. Neem contact op met G&R Solutions als u meer moet sturen.', _max_per_order
          using errcode = '54000';
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

revoke all on function private.order_documents_before_insert() from public, anon, authenticated, service_role;

-- ===========================================================================
-- 2. has_role(): a customer asks only about themselves
-- ===========================================================================

-- As in 20261007150000_p5_customers.sql (a blocked login holds no role), plus:
-- a signed-in caller who is not staff gets false for any other login.
create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when (select auth.uid()) is not null
     and _user_id is distinct from (select auth.uid())
     and not (select public.is_staff())
      then false
    else exists (
      select 1
      from public.user_roles r
      join auth.users u on u.id = r.user_id
      where r.user_id = _user_id and r.role = _role
        and (u.banned_until is null or u.banned_until <= now())
    )
  end
$$;

revoke all on function public.has_role(uuid, public.app_role) from public, anon, authenticated, service_role;
grant execute on function public.has_role(uuid, public.app_role) to authenticated;

-- ===========================================================================
-- 3. log_recovery_link(): audit a reset link before it exists
-- ===========================================================================

-- Called by the server function with the staff member's own session, before
-- auth.admin.generateLink. audit_log row: table 'recovery_link', record = the
-- target login, actor = the staff member, new_data = which customer (if any)
-- and whether the login belongs to the team. Same rules as the app: any
-- staff member for a customer login, only an admin for a team login.
create or replace function public.log_recovery_link(_user_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  _team boolean;
  _customer record;
begin
  if not (select public.is_staff()) then
    raise exception 'Geen toegang' using errcode = '42501';
  end if;
  if _user_id is null then
    raise exception 'Gebruiker is verplicht' using errcode = '22023';
  end if;
  if not exists (select 1 from auth.users u where u.id = _user_id) then
    raise exception 'Gebruiker niet gevonden' using errcode = 'P0002';
  end if;
  -- Blocked team members still have their user_roles rows: they count as team.
  _team := exists (select 1 from public.user_roles r where r.user_id = _user_id);
  if _team and not (select public.is_admin()) then
    raise exception 'Geen toegang: alleen een beheerder maakt een resetlink voor een teamlid'
      using errcode = '42501';
  end if;
  select c.id, c.customer_code, c.full_name into _customer
  from public.customers c where c.user_id = _user_id;

  insert into public.audit_log (actor_id, table_name, record_id, action, new_data)
  values ((select auth.uid()), 'recovery_link', _user_id::text, 'INSERT',
          jsonb_build_object(
            'user_id', _user_id,
            'team', _team,
            'customer_id', _customer.id,
            'customer_code', _customer.customer_code,
            'full_name', _customer.full_name));
end
$$;

revoke all on function public.log_recovery_link(uuid) from public, anon, authenticated, service_role;
grant execute on function public.log_recovery_link(uuid) to authenticated;

-- ===========================================================================
-- 4. internal_notes in the audit log
-- ===========================================================================

drop trigger if exists internal_notes_audit on public.internal_notes;
create trigger internal_notes_audit
  after insert or update or delete on public.internal_notes
  for each row execute function private.audit_row();
