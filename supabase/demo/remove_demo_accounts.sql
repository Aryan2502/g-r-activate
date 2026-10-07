-- G&R Activate: remove the demo accounts and all their data (docs/DEMO.md).
--
-- Run in Supabase → SQL Editor. Removes the four demo logins of
-- create_demo_accounts.sql and everything linked to the two demo customers
-- (orders, documents records, status history, invoices, payments, e-mail logs,
-- notes, tasks). Nothing else is touched. One transaction: an error changes
-- nothing. Uploaded demo files, if any, are removed by the daily clean-up or
-- via Supabase → Storage → order-documents.

do $$
declare
  _emails constant text[] := array[
    'demo.beheerder@example.com', 'demo.medewerker@example.com',
    'demo.klant@example.com', 'demo.zakelijk@example.com'];
  _users uuid[];
  _customers uuid[];
  _invoices uuid[];
begin
  select coalesce(array_agg(u.id), '{}') into _users
  from auth.users u where lower(u.email) = any(_emails);
  select coalesce(array_agg(c.id), '{}') into _customers
  from public.customers c where c.user_id = any(_users) or lower(c.email) = any(_emails);
  select coalesce(array_agg(i.id), '{}') into _invoices
  from public.invoices i where i.customer_id = any(_customers);

  -- Issued invoices and payments are never deleted, except here.
  alter table public.payments disable trigger payments_guard;
  alter table public.invoices disable trigger invoices_guard;
  alter table public.invoice_items disable trigger invoice_items_guard;

  delete from public.payments where invoice_id = any(_invoices);
  update public.invoices set replaces_invoice_id = null where id = any(_invoices);
  delete from public.invoices where id = any(_invoices);
  delete from public.email_logs where customer_id = any(_customers) or invoice_id = any(_invoices);
  delete from public.orders where customer_id = any(_customers);
  delete from public.staff_tasks where customer_id = any(_customers);
  delete from public.internal_notes where customer_id = any(_customers);
  delete from public.invitations where customer_id = any(_customers);
  delete from public.customers where id = any(_customers);

  alter table public.payments enable trigger payments_guard;
  alter table public.invoices enable trigger invoices_guard;
  alter table public.invoice_items enable trigger invoice_items_guard;

  delete from public.user_roles where user_id = any(_users);
  delete from auth.users where id = any(_users);

  raise notice 'Verwijderd: % demo-logins en % demo-klantdossiers.',
    coalesce(array_length(_users, 1), 0), coalesce(array_length(_customers, 1), 0);
end
$$;
