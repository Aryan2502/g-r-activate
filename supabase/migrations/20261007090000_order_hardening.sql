-- Hardening found in the P3 review (docs/PROGRESS.md, carry-over fixes).
-- 1. Storage: a customer may upload only into the folder of one of their own
--    orders that still accepts documents. Before this, the object landed in
--    storage even when the order_documents row was then refused.
-- 2. A purchase split over several packages keeps one order type, store and
--    vendor order number; customers cannot let the packages drift apart.

create or replace function public.can_upload_order_object(_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select array_length(storage.foldername(_name), 1) = 2
     and exists (
       select 1
       from public.orders o
       join public.shipment_statuses s on s.code = o.status
       where o.id::text = (storage.foldername(_name))[2]
         and o.customer_id::text = (storage.foldername(_name))[1]
         and (
           (select public.is_staff())
           or (o.customer_id = (select public.current_customer_id())
               and s.stage not in ('completed', 'cancelled'))
         )
     )
$$;
revoke all on function public.can_upload_order_object(text) from public, anon;
grant execute on function public.can_upload_order_object(text) to authenticated;

drop policy if exists order_documents_objects_insert on storage.objects;
create policy order_documents_objects_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'order-documents' and public.can_upload_order_object(name));

create or replace function private.orders_group_consistency()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  _root record;
begin
  if (select public.is_staff()) then
    return new;
  end if;
  if new.parent_order_id is not null then
    select r.order_type, r.store_vendor, r.vendor_order_number into _root
    from public.orders r where r.id = new.parent_order_id;
    if found and (
      new.order_type is distinct from _root.order_type
      or (_root.store_vendor is not null and new.store_vendor is distinct from _root.store_vendor)
      or (_root.vendor_order_number is not null
          and new.vendor_order_number is distinct from _root.vendor_order_number)
    ) then
      raise exception 'Een extra pakket heeft dezelfde soort order, winkel en ordernummer als de hoofdorder'
        using errcode = '22023';
    end if;
  end if;
  if tg_op = 'UPDATE'
     and exists (select 1 from public.orders c where c.parent_order_id = new.id)
     and (
       new.order_type is distinct from old.order_type
       or (old.store_vendor is not null and new.store_vendor is distinct from old.store_vendor)
       or (old.vendor_order_number is not null
           and new.vendor_order_number is distinct from old.vendor_order_number)
     ) then
    raise exception 'Soort order, winkel en ordernummer gelden voor alle pakketten van deze aankoop. Neem contact op met G&R Solutions om ze te wijzigen.'
      using errcode = '55000';
  end if;
  return new;
end
$$;

drop trigger if exists orders_group_consistency on public.orders;
create trigger orders_group_consistency
  before insert or update of order_type, store_vendor, vendor_order_number, parent_order_id
  on public.orders
  for each row execute function private.orders_group_consistency();

revoke all on function private.orders_group_consistency() from public, anon, authenticated;
