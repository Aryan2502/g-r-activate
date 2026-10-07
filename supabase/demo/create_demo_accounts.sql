-- G&R Activate: demo accounts and demo data for testing (docs/DEMO.md).
--
-- Run in Supabase → SQL Editor (as the default postgres role). The last result
-- table shows the four logins with freshly generated passwords. Passwords are
-- created here, at random, and are not stored anywhere in the repository.
-- Running the script again gives the same accounts NEW passwords; the demo data
-- is only created the first time.
--
-- Accounts (all @example.com, no e-mail is ever sent to them):
--   demo.beheerder@example.com   admin
--   demo.medewerker@example.com  staff
--   demo.klant@example.com       customer (personal) with orders and invoices
--   demo.zakelijk@example.com    customer (business) with a B2B order
--
-- Remove everything again with supabase/demo/remove_demo_accounts.sql, or with
-- the pre-go-live reset (docs/DEPLOYMENT.md §8.2) plus that script for the two
-- team logins.

create temp table if not exists demo_inloggegevens (
  volgorde int,
  rol text,
  email text,
  wachtwoord text,
  klantcode text
);
truncate demo_inloggegevens;

do $$
declare
  _demo record;
  _uid uuid;
  _pw text;
  _new boolean;
  _admin uuid;
  _klant uuid;
  _zakelijk uuid;
  _o_registered uuid;
  _o_transit uuid;
  _o_ready uuid;
  _o_paid uuid;
  _o_b2b uuid;
  _inv_open uuid;
  _inv_paid uuid;
  _total numeric;
  _today date := (now() at time zone 'America/Paramaribo')::date;
  _signup boolean;
begin
  -- The sign-up trigger only creates customer records while public sign-up is
  -- on; allow it for this transaction and put the setting back at the end.
  select s.public_signup_enabled into _signup from public.company_settings s where s.id;
  if not coalesce(_signup, true) then
    update public.company_settings set public_signup_enabled = true where id;
  end if;

  for _demo in
    select * from (values
      (1, 'beheerder', 'demo.beheerder@example.com', 'Demo Beheerder', null::text, 'personal', null::text),
      (2, 'medewerker', 'demo.medewerker@example.com', 'Demo Medewerker', null, 'personal', null),
      (3, 'klant', 'demo.klant@example.com', 'Demo Klant', '+5978000001', 'personal', null),
      (4, 'zakelijk', 'demo.zakelijk@example.com', 'Demo Zakelijk', '+5978000002', 'business',
       'Demo Bedrijf N.V.')
    ) v(volgorde, rol, email, naam, telefoon, soort, bedrijf)
    order by volgorde
  loop
    _pw := 'Demo-' || translate(encode(extensions.gen_random_bytes(12), 'base64'), '+/=', 'kmz');
    select u.id into _uid from auth.users u where lower(u.email) = _demo.email;
    _new := _uid is null;

    if _new then
      _uid := gen_random_uuid();
      -- Team logins are inserted unconfirmed, get their role, and are confirmed
      -- afterwards, so the sign-up trigger never creates a customer record for them.
      insert into auth.users (
        instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
        confirmation_token, recovery_token, email_change_token_new, email_change,
        email_change_token_current, phone_change, phone_change_token, reauthentication_token
      ) values (
        '00000000-0000-0000-0000-000000000000', _uid, 'authenticated', 'authenticated',
        _demo.email, extensions.crypt(_pw, extensions.gen_salt('bf')),
        case when _demo.volgorde <= 2 then null else now() end,
        '{"provider":"email","providers":["email"]}'::jsonb,
        jsonb_strip_nulls(jsonb_build_object(
          'full_name', _demo.naam, 'phone', _demo.telefoon, 'account_type', _demo.soort,
          'company_name', _demo.bedrijf, 'terms_version', '1')),
        now(), now(), '', '', '', '', '', '', '', ''
      );
      insert into auth.identities (
        id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at
      ) values (
        gen_random_uuid(), _uid, _uid::text, 'email',
        jsonb_build_object('sub', _uid::text, 'email', _demo.email, 'email_verified', true),
        now(), now(), now()
      );
      if _demo.volgorde <= 2 then
        insert into public.user_roles (user_id, role)
        values (_uid, case when _demo.volgorde = 1 then 'admin' else 'staff' end::public.app_role)
        on conflict (user_id, role) do nothing;
        update public.profiles set display_name = _demo.naam where id = _uid;
        update auth.users set email_confirmed_at = now() where id = _uid;
      end if;
    else
      update auth.users
         set encrypted_password = extensions.crypt(_pw, extensions.gen_salt('bf')),
             email_confirmed_at = coalesce(email_confirmed_at, now()),
             banned_until = null,
             updated_at = now()
       where id = _uid;
    end if;

    insert into demo_inloggegevens
    select _demo.volgorde, _demo.rol, _demo.email, _pw,
           (select c.customer_code from public.customers c where c.user_id = _uid);

    case _demo.volgorde
      when 1 then _admin := _uid;
      when 3 then select c.id into _klant from public.customers c where c.user_id = _uid;
      when 4 then select c.id into _zakelijk from public.customers c where c.user_id = _uid;
      else null;
    end case;
  end loop;

  if not coalesce(_signup, true) then
    update public.company_settings set public_signup_enabled = false where id;
  end if;

  if _klant is null or _zakelijk is null then
    raise exception 'Demo-klantdossiers ontbreken; controleer of het e-mailadres al een ander klantdossier heeft.';
  end if;

  -- Demo data only once: skip when the demo customer already has orders.
  if exists (select 1 from public.orders o where o.customer_id = _klant) then
    return;
  end if;

  -- Act as the demo admin, so the guarded functions and the audit log see a user.
  perform set_config('request.jwt.claims',
    json_build_object('sub', _admin, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', _admin::text, true);

  insert into public.orders (customer_id, order_type, store_vendor, vendor_order_number,
                             description, estimated_value, purchase_date, tracking_number, carrier)
  values (_klant, 'personal', 'Amazon', '112-0000001-0000001', 'Hardloopschoenen', 89.99,
          _today - 2, null, null)
  returning id into _o_registered;

  insert into public.orders (customer_id, order_type, store_vendor, vendor_order_number,
                             description, estimated_value, purchase_date, tracking_number, carrier)
  values (_klant, 'personal', 'eBay', '01-00000-00002', 'Koptelefoon', 59.00, _today - 9,
          '1Z999AA10000000002', 'UPS')
  returning id into _o_transit;

  insert into public.orders (customer_id, order_type, store_vendor, vendor_order_number,
                             description, estimated_value, purchase_date, tracking_number, carrier)
  values (_klant, 'personal', 'Shein', 'GSUS0000003', 'Kleding (3 stuks)', 45.50, _today - 14,
          '9400100000000000000003', 'USPS')
  returning id into _o_ready;

  insert into public.orders (customer_id, order_type, store_vendor, vendor_order_number,
                             description, estimated_value, purchase_date, tracking_number, carrier)
  values (_klant, 'personal', 'Walmart', '2000000-00004', 'Keukenmixer', 120.00, _today - 21,
          '1Z999AA10000000004', 'UPS')
  returning id into _o_paid;

  insert into public.orders (customer_id, order_type, store_vendor, vendor_order_number,
                             description, estimated_value, purchase_date, tracking_number,
                             carrier, supplier_name, client_po_number, purchase_mode)
  values (_zakelijk, 'b2b', 'Home Depot', 'HD-0000005', 'Bouwmaterialen (gereedschap)', 850.00,
          _today - 12, '1Z999AA10000000005', 'UPS', 'Home Depot Pro', 'PO-2026-001',
          'customer_purchased')
  returning id into _o_b2b;

  perform public.receive_order(_o_transit, 5.20);
  perform public.receive_order(_o_ready, 3.00);
  perform public.receive_order(_o_paid, 8.50);
  perform public.receive_order(_o_b2b, 42.00);
  perform public.change_order_status(array[_o_transit], 'in_transit',
    'Uw pakket is onderweg naar Suriname.', null);
  perform public.change_order_status(array[_o_ready, _o_paid], 'ready_for_pickup',
    'Uw pakket ligt klaar om af te halen.', null);
  perform public.change_order_status(array[_o_b2b], 'at_customs', null, null);

  -- An open invoice for the package that is ready for pickup.
  insert into public.invoices (customer_id, currency, invoice_date, due_date, customer_note)
  values (_klant, 'USD', _today, _today + 7, 'Demofactuur')
  returning id into _inv_open;
  insert into public.invoice_items (invoice_id, order_id, line_type, description,
                                    weight_lbs, rate_per_lb, amount, vat_exempt, sort_order)
  values (_inv_open, _o_ready, 'freight', 'Shein – order GSUS0000003', 3.00, 4.50, 13.50, false, 0),
         (_inv_open, _o_ready, 'handling', 'Handlingkosten', null, null, 5.00, false, 1);
  perform public.issue_invoice(_inv_open);

  -- A paid invoice, and that package handed over.
  insert into public.invoices (customer_id, currency, invoice_date, due_date, customer_note)
  values (_klant, 'USD', _today, _today + 7, 'Demofactuur')
  returning id into _inv_paid;
  insert into public.invoice_items (invoice_id, order_id, line_type, description,
                                    weight_lbs, rate_per_lb, amount, vat_exempt, sort_order)
  values (_inv_paid, _o_paid, 'freight', 'Walmart – order 2000000-00004', 8.50, 4.50, 38.25, false, 0),
         (_inv_paid, _o_paid, 'customs', 'Inklaringskosten / douane', null, null, 15.00, true, 1);
  perform public.issue_invoice(_inv_paid);
  select i.total_amount into _total from public.invoices i where i.id = _inv_paid;
  perform public.record_payment(_inv_paid, _total, _today, 'cash', 'DEMO', null, null, null);
  perform public.change_order_status(array[_o_paid], 'picked_up', null, 'Demo Klant');
end
$$;

select rol, email, wachtwoord, coalesce(klantcode, '–') as klantcode
from demo_inloggegevens
order by volgorde;
