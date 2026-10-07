-- =============================================================================
-- G&R Activate: RLS-controle (SPEC §23, §35.15)
--
-- WAT HET DOET
--   Maakt in één transactie wegwerp-testgebruikers aan: klant A, klant B, een
--   gedeactiveerde klant C, klant D zonder login, een medewerker en een
--   beheerder (vaste uuid's, adressen rls-…@example.com). Daarna doet het
--   script zich voor als ieder van hen, precies zoals de app dat doet
--   (`set local role authenticated` plus `request.jwt.claims`), en probeert
--   het alles wat niet mag. Lukt iets wat niet mag, of ziet iemand te veel of
--   te weinig, dan stopt het met een melding die begint met
--   "RLS-CONTROLE MISLUKT [wie]: …".
--   Aan het eind wordt ALLES teruggedraaid (rollback): er blijft niets achter.
--   De testklanten krijgen vaste nummers (GR99991 t/m GR99994), dus ook de
--   reeks voor nieuwe klantcodes verspringt niet. Alleen interne volgnummers
--   (auditlog, statusgeschiedenis) kunnen een paar nummers overslaan; dat is
--   onschuldig.
--
-- UITVOEREN
--   Supabase → SQL Editor → New query → plak dit HELE bestand → Run.
--   Goed:  de uitkomst is één rij "ALLE RLS-CONTROLES GESLAAGD".
--   Fout:  een melding "RLS-CONTROLE MISLUKT [wie]: wat er misging". Er is dan
--          ook niets opgeslagen. Meldt de editor bij een volgende query
--          "current transaction is aborted", voer dan eerst `rollback;` uit.
--          Een fout die NIET met "RLS-CONTROLE MISLUKT" begint, betekent dat
--          de testgegevens niet konden worden aangemaakt (bijv. een migratie
--          die nog niet is toegepast, of een instelling die het script niet
--          verwacht); ook dan is niets opgeslagen. Stuur de melding door.
--          De instellingen waar het script van afhangt (luchtvracht aan, het
--          maximum aan openstaande aanmeldingen) zet het zelf goed, alleen
--          binnen de transactie.
--   De editor kan waarschuwen dat de query "destructive operations" bevat:
--   klopt (het script probeert juist dingen die niet mogen) en alles wordt
--   teruggedraaid. Kies "Run this query".
--   Draai het na elke nieuwe migratie opnieuw, en vóór livegang (DEPLOYMENT.md).
--
-- WAT ER WORDT GECONTROLEERD (SPEC §35.15)
--   - A ziet of wijzigt geen rijen van B (en B niet van A), in elke klanttabel
--     en in storage.objects, en ziet precies de eigen rijen (ook die van echte
--     klanten tellen mee: A mag niets van wie dan ook zien);
--   - A ziet geen concepten en geen ongedaan gemaakte betalingen;
--   - A kan de eigen klantcode, status of login niet wijzigen, geen order voor
--     B aanmelden en geen status zetten;
--   - elke staff-/beheerders-RPC geeft A fout 42501;
--   - A leest geen internal_notes, audit_log, invitations, email_logs,
--     job_runs of staff_tasks;
--   - niemand (klant, medewerker, beheerder, service role) wijzigt een
--     uitgegeven factuur, haar regels of betalingen;
--   - C (gedeactiveerd) ziet niets;
--   - medewerker en beheerder missen geen rijen; een medewerker kan geen
--     beheerderstaken doen;
--   - anon ziet niets en mag alleen public_company_info() aanroepen.
--
-- Getest: supabase/tests/pglite/rls_checks_script.test.ts draait dit bestand
-- ongewijzigd tegen alle migraties, en met opzet kapotgemaakte policies om te
-- bewijzen dat het script dan faalt.
-- =============================================================================

begin;

-- =============================================================================
-- 1. Hulpfuncties (tijdelijk: pg_temp, verdwijnen met de rollback)
-- =============================================================================

-- Vaste id's van de testgegevens. Een onbekende naam is een fout, zodat een
-- tikfout nooit een controle laat slagen die niets controleert.
create function pg_temp.rls_id(_naam text) returns uuid
language plpgsql immutable as $f$
declare
  _sfx text := case _naam
    when 'gebruiker A' then 'a1' when 'gebruiker B' then 'b1' when 'gebruiker C' then 'c1'
    when 'medewerker' then 'e1' when 'beheerder' then 'f1'
    when 'klant A' then 'a2' when 'klant B' then 'b2' when 'klant C' then 'c2' when 'klant D' then 'd2'
    when 'order A1' then 'a3' when 'order A2' then 'a4' when 'order B1' then 'b3'
    when 'order B2' then 'b4' when 'order C1' then 'c3'
    when 'zending A' then 'a5' when 'zending B' then 'b5'
    when 'factuur A' then 'a6' when 'concept A' then 'a7' when 'factuur B' then 'b6'
    when 'concept B' then 'b7' when 'factuur C' then 'c6'
    when 'regel A' then 'a8' when 'conceptregel A' then 'a9' when 'regel B' then 'b8'
    when 'conceptregel B' then 'b9' when 'regel C' then 'c8'
    when 'betaling A1' then 'aa' when 'betaling A2' then 'ab'
    when 'betaling B1' then 'ba' when 'betaling B2' then 'bb'
    when 'notitie A' then 'ac' when 'notitie B' then 'bc'
    when 'bestand A' then 'ad' when 'bestand B' then 'bd' when 'bestand C' then 'cd'
    when 'e-mail A' then 'ae' when 'e-mail B' then 'be'
    when 'uitnodiging D' then 'dd' when 'taakrun' then 'ef'
  end;
begin
  if _sfx is null then
    raise exception 'rls_id: onbekende naam "%"', _naam;
  end if;
  return ('00000000-0000-4000-8000-0000000000' || _sfx)::uuid;
end
$f$;

create function pg_temp.rls_ids(_soort text) returns uuid[]
language plpgsql immutable as $f$
begin
  return case _soort
    when 'gebruikers' then array[pg_temp.rls_id('gebruiker A'), pg_temp.rls_id('gebruiker B'),
      pg_temp.rls_id('gebruiker C'), pg_temp.rls_id('medewerker'), pg_temp.rls_id('beheerder')]
    when 'klanten' then array[pg_temp.rls_id('klant A'), pg_temp.rls_id('klant B'),
      pg_temp.rls_id('klant C'), pg_temp.rls_id('klant D')]
    when 'orders' then array[pg_temp.rls_id('order A1'), pg_temp.rls_id('order A2'),
      pg_temp.rls_id('order B1'), pg_temp.rls_id('order B2'), pg_temp.rls_id('order C1')]
    when 'facturen' then array[pg_temp.rls_id('factuur A'), pg_temp.rls_id('concept A'),
      pg_temp.rls_id('factuur B'), pg_temp.rls_id('concept B'), pg_temp.rls_id('factuur C')]
    else null
  end;
end
$f$;

-- Pad van het testdocument van klant A, B of C: {klant}/{order}/{bestand}.pdf
create function pg_temp.rls_pad(_wie text) returns text
language sql immutable as $f$
  select pg_temp.rls_id('klant ' || _wie) || '/' || pg_temp.rls_id('order ' || _wie || '1')
      || '/' || pg_temp.rls_id('bestand ' || _wie) || '.pdf'
$f$;

-- Zet de identiteit zoals PostgREST en de Storage API dat doen. De rol zelf
-- wordt daarna zichtbaar in het script gezet (`set local role …`).
create function pg_temp.rls_als(_wie text) returns void
language plpgsql as $f$
declare
  _sub uuid;
  _rol text := 'authenticated';
begin
  case _wie
    when 'klant A' then _sub := pg_temp.rls_id('gebruiker A');
    when 'klant B' then _sub := pg_temp.rls_id('gebruiker B');
    when 'klant C' then _sub := pg_temp.rls_id('gebruiker C');
    when 'medewerker' then _sub := pg_temp.rls_id('medewerker');
    when 'beheerder' then _sub := pg_temp.rls_id('beheerder');
    when 'anon' then _rol := 'anon';
    when 'service_role' then _rol := 'service_role';
    when 'systeem' then _rol := null;
    else raise exception 'rls_als: onbekende identiteit "%"', _wie;
  end case;
  perform set_config('rls.actor', _wie, true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', case
    when _rol is null then ''
    when _sub is null then jsonb_build_object('role', _rol)::text
    else jsonb_build_object('sub', _sub, 'role', _rol, 'aud', 'authenticated',
      'email', (select u.email from auth.users u where u.id = _sub))::text
  end, true);
end
$f$;

-- Telt de uitgevoerde controles (voor de slotmelding).
create function pg_temp.rls_geteld() returns void
language plpgsql as $f$
begin
  perform set_config('rls.aantal', (coalesce(nullif(current_setting('rls.aantal', true), ''), '0')::int + 1)::text, true);
end
$f$;

create function pg_temp.rls_fout(_wat text) returns void
language plpgsql as $f$
begin
  raise exception 'RLS-CONTROLE MISLUKT [%]: %', current_setting('rls.actor', true), _wat;
end
$f$;

-- De identiteit moet echt zijn overgenomen; anders slagen alle "ziet niets"-
-- controles zonder iets te bewijzen.
create function pg_temp.rls_ik_ben(_rol text, _gebruiker text) returns void
language plpgsql as $f$
begin
  if current_user::text <> _rol
     or auth.uid() is distinct from (case when _gebruiker is null then null else pg_temp.rls_id(_gebruiker) end) then
    perform pg_temp.rls_fout(format('identiteit niet overgenomen (rol %s, auth.uid() %s)', current_user, auth.uid()));
  end if;
end
$f$;

-- Telt wat de huidige identiteit ziet. Geen leesrecht (42501) telt als 0.
create function pg_temp.rls_tel(_wat text, _sql text, _verwacht bigint) returns void
language plpgsql as $f$
declare
  _n bigint;
  _state text;
  _msg text;
begin
  begin
    execute _sql into _n;
  exception
    when insufficient_privilege then
      _n := 0;
    when others then
      get stacked diagnostics _state = returned_sqlstate, _msg = message_text;
      perform pg_temp.rls_fout(format('%s: onverwachte fout %s (%s)', _wat, _state, _msg));
  end;
  if _n is distinct from _verwacht then
    perform pg_temp.rls_fout(format('%s (verwacht %s, gezien %s)', _wat, _verwacht, _n));
  end if;
  perform pg_temp.rls_geteld();
end
$f$;

-- Een poging die niet mag. Geslaagd is: een fout met een van de verwachte
-- SQLSTATE's, of 0 geraakte rijen (RLS filtert stil). Elke poging wordt
-- daarna teruggedraaid, ook een die (ten onrechte) lukte.
create function pg_temp.rls_geweigerd(_wat text, _sql text, _codes text[] default array['42501'])
returns void
language plpgsql as $f$
declare
  _n bigint := 0;
  _state text;
  _msg text;
begin
  begin
    begin
      execute _sql;
      get diagnostics _n = row_count;
    exception when others then
      get stacked diagnostics _state = returned_sqlstate, _msg = message_text;
    end;
    raise exception using errcode = 'RLS00', message = 'poging terugdraaien';
  exception when sqlstate 'RLS00' then
    null;
  end;
  if _state is not null and not (_state = any (_codes)) then
    perform pg_temp.rls_fout(format('%s: onverwachte fout %s (%s)', _wat, _state, _msg));
  elsif _state is null and _n > 0 then
    perform pg_temp.rls_fout(format('%s is gelukt (%s rij(en))', _wat, _n));
  end if;
  perform pg_temp.rls_geteld();
end
$f$;

-- Een RPC die deze identiteit niet mag aanroepen: alleen fout 42501 is goed.
create function pg_temp.rls_rpc_geweigerd(_wat text, _sql text) returns void
language plpgsql as $f$
declare
  _state text;
  _msg text;
begin
  begin
    begin
      execute _sql;
    exception when others then
      get stacked diagnostics _state = returned_sqlstate, _msg = message_text;
    end;
    raise exception using errcode = 'RLS00', message = 'poging terugdraaien';
  exception when sqlstate 'RLS00' then
    null;
  end;
  if _state is null then
    perform pg_temp.rls_fout(format('%s is gelukt; verwacht fout 42501', _wat));
  elsif _state <> '42501' then
    perform pg_temp.rls_fout(format('%s gaf fout %s in plaats van 42501 (%s)', _wat, _state, _msg));
  end if;
  perform pg_temp.rls_geteld();
end
$f$;

-- Iets wat wél moet lukken (bewijst dat de identiteit en de testgegevens
-- kloppen). Met _rijen ook het aantal geraakte rijen. Wordt teruggedraaid.
create function pg_temp.rls_lukt(_wat text, _sql text, _rijen bigint default null) returns void
language plpgsql as $f$
declare
  _n bigint;
  _state text;
  _msg text;
begin
  begin
    begin
      execute _sql;
      get diagnostics _n = row_count;
    exception when others then
      get stacked diagnostics _state = returned_sqlstate, _msg = message_text;
    end;
    raise exception using errcode = 'RLS00', message = 'poging terugdraaien';
  exception when sqlstate 'RLS00' then
    null;
  end;
  if _state is not null then
    perform pg_temp.rls_fout(format('%s mislukte: %s (%s)', _wat, _state, _msg));
  elsif _rijen is not null and _n <> _rijen then
    perform pg_temp.rls_fout(format('%s raakte %s rij(en) in plaats van %s', _wat, _n, _rijen));
  end if;
  perform pg_temp.rls_geteld();
end
$f$;

-- Voert een INSERT/UPDATE … RETURNING uit, geeft de rij als jsonb terug en
-- draait de wijziging terug.
create function pg_temp.rls_rij(_wat text, _sql text) returns jsonb
language plpgsql as $f$
declare
  _rij jsonb;
  _state text;
  _msg text;
begin
  begin
    begin
      execute format('with r as (%s) select to_jsonb(r) from r', _sql) into _rij;
    exception when others then
      get stacked diagnostics _state = returned_sqlstate, _msg = message_text;
    end;
    raise exception using errcode = 'RLS00', message = 'poging terugdraaien';
  exception when sqlstate 'RLS00' then
    null;
  end;
  if _state is not null then
    perform pg_temp.rls_fout(format('%s mislukte: %s (%s)', _wat, _state, _msg));
  end if;
  return _rij;
end
$f$;

-- Een upload zoals de browser die doet (als de klant zelf): eerst het bestand
-- in storage, dan de rij in order_documents.
create function pg_temp.rls_upload(_wie text, _soort text) returns void
language plpgsql as $f$
declare
  _state text;
  _msg text;
begin
  insert into storage.objects (bucket_id, name) values ('order-documents', pg_temp.rls_pad(_wie));
  insert into public.order_documents (order_id, customer_id, kind, storage_path, original_filename, mime_type, size_bytes)
  values (pg_temp.rls_id('order ' || _wie || '1'), pg_temp.rls_id('klant ' || _wie), _soort::public.order_document_kind,
          pg_temp.rls_pad(_wie), 'rls-' || lower(_wie) || '.pdf', 'application/pdf', 1024);
exception when others then
  get stacked diagnostics _state = returned_sqlstate, _msg = message_text;
  perform pg_temp.rls_fout(format('voorbereiding: uploaden bij de eigen order mislukte: %s (%s)', _state, _msg));
end
$f$;

-- Verwachte aantallen die pas na het aanmaken vastliggen (zie stap 2.6).
create function pg_temp.rls_verwacht(_sleutel text) returns bigint
language plpgsql stable as $f$
declare
  _n bigint := (current_setting('rls.verwacht')::jsonb ->> _sleutel)::bigint;
begin
  if _n is null then
    raise exception 'rls_verwacht: onbekende sleutel "%"', _sleutel;
  end if;
  return _n;
end
$f$;

-- Vingerafdruk van een factuur met regels en betalingen (alleen als postgres).
create function pg_temp.rls_vingerafdruk(_factuur uuid) returns text
language sql stable as $f$
  select md5(concat_ws('|',
    (select (to_jsonb(i) - 'updated_at' - 'updated_by')::text from public.invoices i where i.id = _factuur),
    (select jsonb_agg(to_jsonb(li) - 'updated_at' - 'updated_by' order by li.id)::text
       from public.invoice_items li where li.invoice_id = _factuur),
    (select jsonb_agg(to_jsonb(p) order by p.id)::text from public.payments p where p.invoice_id = _factuur)))
$f$;

-- Klantfuncties die een klant hoort te kunnen aanroepen; elke andere functie
-- in public moet een klant fout 42501 geven.
create function pg_temp.rls_klantfuncties() returns text[]
language sql immutable as $f$
  select array['can_upload_order_object', 'current_customer_id', 'customer_history_by_year',
               'has_role', 'is_admin', 'is_staff', 'public_company_info',
               'request_order_cancellation', 'update_my_contact']
$f$;

-- Staff-RPC's (medewerker en beheerder) en beheerders-RPC's (SPEC §35.4).
create function pg_temp.rls_teamfuncties() returns text[]
language sql immutable as $f$
  select array['change_order_status', 'create_customer', 'issue_invoice',
               'keep_order_after_cancellation_request', 'log_recovery_link',
               'peek_next_customer_number', 'pickup_override', 'receive_order', 'record_payment',
               'team_members']
$f$;

create function pg_temp.rls_beheerfuncties() returns text[]
language sql immutable as $f$
  select array['apply_late_fee', 'cancel_invoice', 'change_customer_code', 'log_team_login_change',
               'set_invoice_counter', 'set_next_customer_number', 'set_user_role', 'void_payment']
$f$;

-- Alleen voor de server (service role); nooit voor klanten, team of anon.
create function pg_temp.rls_serverfuncties() returns text[]
language sql immutable as $f$
  select array['admin_auth_user_by_email', 'get_invitation', 'orphan_order_document_objects',
               'redeem_invitation']
$f$;

-- Elke eigen functie in public (geen extensie, geen trigger), met een aanroep
-- waarin elk argument NULL is: de toegangscontrole hoort vóór alles te komen.
create function pg_temp.rls_functies()
returns table (naam text, fn oid, aanroep text)
language sql stable as $f$
  select p.proname::text, p.oid,
         format('select * from public.%I(%s)', p.proname,
           coalesce((select string_agg(format('null::%s', format_type(t.oid, null)), ', ' order by t.n)
                       from unnest(p.proargtypes::oid[]) with ordinality as t(oid, n)), ''))
  from pg_proc p
  join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'public'
    and p.prokind = 'f'
    and p.prorettype <> 'trigger'::regtype
    and not exists (
      select 1 from pg_depend d
      where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
  order by 1
$f$;

-- Pogingen om uitgegeven factuur A, haar regels of betalingen te wijzigen.
-- 42501 (geen recht / RLS) en 55000 (de factuurtriggers) zijn beide goed;
-- bij klanten mag RLS de rij ook stil wegfilteren.
create function pg_temp.rls_factuur_onwijzigbaar() returns void
language plpgsql as $f$
declare
  _r record;
begin
  for _r in
    select * from (values
      ('wijzigt de opmerking op uitgegeven factuur A',
       $q$update public.invoices set customer_note = 'gewijzigd' where id = pg_temp.rls_id('factuur A')$q$),
      ('wijzigt de vervaldatum van uitgegeven factuur A',
       $q$update public.invoices set due_date = due_date + 30 where id = pg_temp.rls_id('factuur A')$q$),
      ('wijzigt de valuta van uitgegeven factuur A',
       $q$update public.invoices set currency = 'EUR' where id = pg_temp.rls_id('factuur A')$q$),
      ('zet het totaal van uitgegeven factuur A op 0',
       $q$update public.invoices set total_amount = 0 where id = pg_temp.rls_id('factuur A')$q$),
      ('wijzigt het nummer van uitgegeven factuur A',
       $q$update public.invoices set invoice_number = 'INV-RLS' where id = pg_temp.rls_id('factuur A')$q$),
      ('zet uitgegeven factuur A terug naar concept',
       $q$update public.invoices set status = 'draft' where id = pg_temp.rls_id('factuur A')$q$),
      ('wijzigt een omschrijving op uitgegeven factuur A',
       $q$update public.invoice_items set description = 'Gewijzigd' where invoice_id = pg_temp.rls_id('factuur A')$q$),
      ('wijzigt gewicht en bedrag op uitgegeven factuur A',
       $q$update public.invoice_items set weight_lbs = 1, amount = round(1 * rate_per_lb, 2)
          where invoice_id = pg_temp.rls_id('factuur A')$q$),
      ('voegt een regel toe aan uitgegeven factuur A',
       $q$insert into public.invoice_items (invoice_id, line_type, description, amount, vat_exempt)
          values (pg_temp.rls_id('factuur A'), 'other', 'RLS extra regel', 1, true)$q$),
      ('verwijdert een regel van uitgegeven factuur A',
       $q$delete from public.invoice_items where invoice_id = pg_temp.rls_id('factuur A')$q$),
      ('verwijdert uitgegeven factuur A',
       $q$delete from public.invoices where id = pg_temp.rls_id('factuur A')$q$),
      ('geeft factuur A opnieuw uit',
       $q$select public.issue_invoice(pg_temp.rls_id('factuur A'))$q$),
      ('wijzigt een betaling op factuur A',
       $q$update public.payments set amount = 1 where invoice_id = pg_temp.rls_id('factuur A')$q$),
      ('verwijdert een betaling van factuur A',
       $q$delete from public.payments where invoice_id = pg_temp.rls_id('factuur A')$q$)
    ) t(wat, q)
  loop
    perform pg_temp.rls_geweigerd(_r.wat, _r.q, array['42501', '55000']);
  end loop;
end
$f$;

-- Alle controles voor een klant (_mij = A of B, _ander = de andere klant).
create function pg_temp.rls_klant(_mij text, _ander text) returns void
language plpgsql as $f$
declare
  _r record;
  _rij jsonb;
  _vul constant text := '{mij}';
begin
  perform pg_temp.rls_ik_ben('authenticated', 'gebruiker ' || _mij);
  perform pg_temp.rls_tel('current_customer_id() is niet het eigen klantdossier',
    format('select count(*) where public.current_customer_id() = %L', pg_temp.rls_id('klant ' || _mij)), 1);

  -- Ziet niets van de andere klant, in elke klanttabel en in storage.
  for _r in
    select replace(replace(t.wat, _vul, _mij), '{ander}', _ander) as wat,
           replace(replace(t.q, _vul, _mij), '{ander}', _ander) as q
    from (values
      ('ziet het klantdossier van klant {ander}',
       $q$select count(*) from public.customers where id = pg_temp.rls_id('klant {ander}')$q$),
      ('ziet klant D (geen login)',
       $q$select count(*) from public.customers where id = pg_temp.rls_id('klant D')$q$),
      ('ziet orders van klant {ander}',
       $q$select count(*) from public.orders where customer_id = pg_temp.rls_id('klant {ander}')$q$),
      ('ziet orderdocumenten van klant {ander}',
       $q$select count(*) from public.order_documents where customer_id = pg_temp.rls_id('klant {ander}')$q$),
      ('ziet het bestand van klant {ander} in storage',
       $q$select count(*) from storage.objects where bucket_id = 'order-documents' and name = pg_temp.rls_pad('{ander}')$q$),
      ('ziet de zending van klant {ander}',
       $q$select count(*) from public.shipments where id = pg_temp.rls_id('zending {ander}')$q$),
      ('ziet statusgeschiedenis van klant {ander}',
       $q$select count(*) from public.shipment_status_history
          where order_id in (pg_temp.rls_id('order {ander}1'), pg_temp.rls_id('order {ander}2'))$q$),
      ('ziet facturen van klant {ander}',
       $q$select count(*) from public.invoices where customer_id = pg_temp.rls_id('klant {ander}')$q$),
      ('ziet factuurregels van klant {ander}',
       $q$select count(*) from public.invoice_items
          where invoice_id in (pg_temp.rls_id('factuur {ander}'), pg_temp.rls_id('concept {ander}'))$q$),
      ('ziet betalingen van klant {ander}',
       $q$select count(*) from public.payments where invoice_id = pg_temp.rls_id('factuur {ander}')$q$),
      ('ziet facturen van klant {ander} in invoice_overview',
       $q$select count(*) from public.invoice_overview where customer_id = pg_temp.rls_id('klant {ander}')$q$),
      ('ziet het profiel van klant {ander}',
       $q$select count(*) from public.profiles where id = pg_temp.rls_id('gebruiker {ander}')$q$),
      ('ziet een conceptfactuur',
       $q$select count(*) from public.invoices where id = pg_temp.rls_id('concept {mij}')$q$),
      ('ziet regels van een conceptfactuur',
       $q$select count(*) from public.invoice_items where invoice_id = pg_temp.rls_id('concept {mij}')$q$),
      ('ziet een conceptfactuur in invoice_overview',
       $q$select count(*) from public.invoice_overview where id = pg_temp.rls_id('concept {mij}')$q$),
      ('ziet een ongedaan gemaakte betaling',
       $q$select count(*) from public.payments where id = pg_temp.rls_id('betaling {mij}2')$q$),
      ('ziet een statuswijziging die niet voor klanten zichtbaar is',
       $q$select count(*) from public.shipment_status_history where to_status = 'rls_intern'$q$),
      ('leest interne notities', $q$select count(*) from public.internal_notes$q$),
      ('leest het auditlog', $q$select count(*) from public.audit_log$q$),
      ('leest uitnodigingen', $q$select count(*) from public.invitations$q$),
      ('leest e-maillogs', $q$select count(*) from public.email_logs$q$),
      ('leest taakruns (job_runs)', $q$select count(*) from public.job_runs$q$),
      ('leest staff-taken', $q$select count(*) from public.staff_tasks$q$),
      ('leest factuurtellers', $q$select count(*) from public.invoice_number_counters$q$),
      ('leest teamrollen', $q$select count(*) from public.user_roles$q$)
    ) t(wat, q)
  loop
    perform pg_temp.rls_tel(_r.wat, _r.q, 0);
  end loop;

  -- Ziet precies de eigen rijen: niet minder, en niets van wie dan ook anders
  -- (ook rijen van echte klanten zouden hier meetellen).
  for _r in
    select replace(t.wat, _vul, _mij) as wat, replace(t.q, _vul, _mij) as q, t.n
    from (values
      ('ziet niet precies het eigen klantdossier', $q$select count(*) from public.customers$q$, 1::bigint),
      ('ziet niet precies de eigen orders', $q$select count(*) from public.orders$q$, 2),
      ('ziet niet precies de eigen orderdocumenten', $q$select count(*) from public.order_documents$q$, 1),
      ('ziet niet precies de eigen bestanden in storage',
       $q$select count(*) from storage.objects where bucket_id = 'order-documents'$q$, 1),
      ('ziet niet precies de eigen zending', $q$select count(*) from public.shipments$q$, 1),
      ('ziet niet precies de eigen statusgeschiedenis',
       $q$select count(*) from public.shipment_status_history$q$, pg_temp.rls_verwacht(_mij || '.historie')),
      ('ziet niet precies de eigen uitgegeven facturen', $q$select count(*) from public.invoices$q$, 1),
      ('ziet niet precies de eigen factuurregels', $q$select count(*) from public.invoice_items$q$, 1),
      ('ziet niet precies de eigen betalingen', $q$select count(*) from public.payments$q$, 1),
      ('ziet niet precies de eigen facturen in invoice_overview',
       $q$select count(*) from public.invoice_overview$q$, 1),
      ('ziet niet precies het eigen profiel', $q$select count(*) from public.profiles$q$, 1),
      ('kan geen document uploaden bij de eigen order',
       $q$select count(*) where public.can_upload_order_object(pg_temp.rls_pad('{mij}'))$q$, 1)
    ) t(wat, q, n)
  loop
    perform pg_temp.rls_tel(_r.wat, _r.q, _r.n);
  end loop;

  -- Wijzigt niets van de andere klant, en niets wat alleen G&R mag.
  for _r in
    select replace(replace(t.wat, _vul, _mij), '{ander}', _ander) as wat,
           replace(replace(t.q, _vul, _mij), '{ander}', _ander) as q
    from (values
      ('wijzigt het klantdossier van klant {ander}',
       $q$update public.customers set full_name = 'Gekaapt' where id = pg_temp.rls_id('klant {ander}')$q$),
      ('koppelt de eigen login aan klant D',
       $q$update public.customers set user_id = auth.uid() where id = pg_temp.rls_id('klant D')$q$),
      ('wijzigt een order van klant {ander}',
       $q$update public.orders set customer_note = 'gekaapt' where id = pg_temp.rls_id('order {ander}2')$q$),
      ('verwijdert een order van klant {ander}',
       $q$delete from public.orders where id = pg_temp.rls_id('order {ander}2')$q$),
      ('meldt een order aan voor klant {ander}',
       $q$insert into public.orders (customer_id, store_vendor, description)
          values (pg_temp.rls_id('klant {ander}'), 'RLS', 'order voor een ander')$q$),
      ('voegt een document toe aan een order van klant {ander}',
       $q$insert into public.order_documents (order_id, customer_id, kind, storage_path, original_filename, mime_type, size_bytes)
          values (pg_temp.rls_id('order {ander}1'), pg_temp.rls_id('klant {ander}'), 'other',
                  pg_temp.rls_id('klant {ander}') || '/' || pg_temp.rls_id('order {ander}1') || '/00000000-0000-4000-8000-000000000999.pdf',
                  'x.pdf', 'application/pdf', 10)$q$),
      ('verwijdert een document van klant {ander}',
       $q$delete from public.order_documents where customer_id = pg_temp.rls_id('klant {ander}')$q$),
      ('uploadt in de map van klant {ander}',
       $q$insert into storage.objects (bucket_id, name)
          values ('order-documents', pg_temp.rls_id('klant {ander}') || '/' || pg_temp.rls_id('order {ander}2')
                  || '/00000000-0000-4000-8000-000000000998.pdf')$q$),
      ('hernoemt het bestand van klant {ander}',
       $q$update storage.objects set name = name || '.x' where bucket_id = 'order-documents' and name = pg_temp.rls_pad('{ander}')$q$),
      ('verwijdert het bestand van klant {ander}',
       $q$select set_config('storage.allow_delete_query', 'true', true);
          delete from storage.objects where bucket_id = 'order-documents' and name = pg_temp.rls_pad('{ander}')$q$),
      ('wijzigt de zending van klant {ander}',
       $q$update public.shipments set carrier = 'gekaapt' where id = pg_temp.rls_id('zending {ander}')$q$),
      ('wijzigt een betaling van klant {ander}',
       $q$update public.payments set amount = 1 where invoice_id = pg_temp.rls_id('factuur {ander}')$q$),
      ('wijzigt het profiel van klant {ander}',
       $q$update public.profiles set display_name = 'Gekaapt' where id = pg_temp.rls_id('gebruiker {ander}')$q$),
      ('wijzigt de eigen klantcode',
       $q$update public.customers set customer_number = 99990 where id = pg_temp.rls_id('klant {mij}')$q$),
      ('wijzigt de eigen status',
       $q$update public.customers set status = 'disabled' where id = pg_temp.rls_id('klant {mij}')$q$),
      ('wijzigt de eigen login (user_id)',
       $q$update public.customers set user_id = null where id = pg_temp.rls_id('klant {mij}')$q$),
      ('wijzigt het eigen e-mailadres',
       $q$update public.customers set email = 'ander@example.com' where id = pg_temp.rls_id('klant {mij}')$q$),
      ('wijzigt eigen contactgegevens buiten update_my_contact om',
       $q$update public.customers set phone = '+597 0000000' where id = pg_temp.rls_id('klant {mij}')$q$),
      ('zet de status van een eigen order',
       $q$update public.orders set status = 'ready_for_pickup' where id = pg_temp.rls_id('order {mij}2')$q$),
      ('zet het gemeten gewicht van een eigen order',
       $q$update public.orders set measured_weight_lbs = 1 where id = pg_temp.rls_id('order {mij}2')$q$),
      ('zet een eigen order in een zending',
       $q$update public.orders set shipment_id = pg_temp.rls_id('zending {mij}') where id = pg_temp.rls_id('order {mij}2')$q$),
      ('markeert een eigen order als ontvangen',
       $q$update public.orders set received_at = now() where id = pg_temp.rls_id('order {mij}2')$q$),
      ('verhuist een eigen order naar klant {ander}',
       $q$update public.orders set customer_id = pg_temp.rls_id('klant {ander}') where id = pg_temp.rls_id('order {mij}2')$q$),
      ('verwijdert een eigen order',
       $q$delete from public.orders where id = pg_temp.rls_id('order {mij}2')$q$),
      ('verwijdert een eigen document',
       $q$delete from public.order_documents where customer_id = pg_temp.rls_id('klant {mij}')$q$),
      ('hernoemt het eigen bestand',
       $q$update storage.objects set name = name || '.x' where bucket_id = 'order-documents' and name = pg_temp.rls_pad('{mij}')$q$),
      ('schrijft statusgeschiedenis',
       $q$insert into public.shipment_status_history (order_id, from_status, to_status)
          values (pg_temp.rls_id('order {mij}2'), 'order_registered', 'ready_for_pickup')$q$),
      ('maakt een zending', $q$insert into public.shipments (shipment_number) values ('RLS-HACK')$q$),
      ('maakt een factuur',
       $q$insert into public.invoices (customer_id, currency) values (pg_temp.rls_id('klant {mij}'), 'USD')$q$),
      ('wijzigt de eigen conceptfactuur',
       $q$update public.invoices set customer_note = 'x' where id = pg_temp.rls_id('concept {mij}')$q$),
      ('verwijdert de eigen conceptfactuur',
       $q$delete from public.invoices where id = pg_temp.rls_id('concept {mij}')$q$),
      ('voegt een regel toe aan de eigen conceptfactuur',
       $q$insert into public.invoice_items (invoice_id, line_type, description, amount, vat_exempt)
          values (pg_temp.rls_id('concept {mij}'), 'discount', 'RLS korting', -10, true)$q$),
      ('boekt een betaling',
       $q$insert into public.payments (invoice_id, amount, method) values (pg_temp.rls_id('factuur {mij}'), 1, 'cash')$q$),
      ('schrijft een interne notitie',
       $q$insert into public.internal_notes (customer_id, body) values (pg_temp.rls_id('klant {mij}'), 'RLS')$q$),
      ('maakt een uitnodiging',
       $q$insert into public.invitations (kind, customer_id, email, token_hash)
          values ('customer', pg_temp.rls_id('klant D'), 'rls-klant-d@example.com', repeat('0', 64))$q$),
      ('trekt een uitnodiging in',
       $q$update public.invitations set revoked_at = now() where id = pg_temp.rls_id('uitnodiging D')$q$),
      ('maakt een staff-taak',
       $q$insert into public.staff_tasks (kind, body) values ('signup_customer_failed', 'RLS')$q$),
      ('geeft zichzelf de beheerdersrol',
       $q$insert into public.user_roles (user_id, role) values (auth.uid(), 'admin')$q$),
      ('wijzigt bedrijfsinstellingen',
       $q$update public.company_settings set public_signup_enabled = not public_signup_enabled$q$),
      ('wijzigt een bankrekening', $q$update public.company_bank_accounts set account_number = 'RLS'$q$),
      ('wijzigt een tarief', $q$update public.service_rates set rate_per_lb = 0$q$),
      ('wijzigt een status', $q$update public.shipment_statuses set label_nl = 'RLS'$q$),
      ('voegt een US-adres toe',
       $q$insert into public.warehouse_addresses (label, address_line1) values ('RLS', 'RLS')$q$),
      ('schrijft een e-maillog',
       $q$insert into public.email_logs (kind, recipient, idempotency_key) values ('welcome', 'x@example.com', 'rls-hack')$q$),
      ('schrijft een taakrun', $q$insert into public.job_runs (job, trigger) values ('rls_hack', 'manual')$q$),
      ('schrijft het auditlog',
       $q$insert into public.audit_log (table_name, record_id, action) values ('orders', 'x', 'UPDATE')$q$),
      ('zet een factuurteller',
       $q$insert into public.invoice_number_counters (year, last_number) values (2099, 1)$q$)
    ) t(wat, q)
  loop
    perform pg_temp.rls_geweigerd(_r.wat, _r.q);
  end loop;

  -- Een order die G&R al verwerkt, wijzigt de klant niet meer (fout 55000).
  perform pg_temp.rls_geweigerd('wijzigt een eigen order die G&R al verwerkt',
    format($q$update public.orders set customer_note = 'te laat' where id = %L$q$, pg_temp.rls_id('order ' || _mij || '1')),
    array['42501', '55000']);

  -- Een eigen order met velden die alleen G&R zet: de database maakt ze leeg.
  _rij := pg_temp.rls_rij('meldt een eigen order aan',
    replace($q$insert into public.orders (customer_id, store_vendor, description, measured_weight_lbs, shipment_id)
              values (pg_temp.rls_id('klant {mij}'), 'RLS', 'RLS-controle', 99, pg_temp.rls_id('zending {mij}'))
              returning status, measured_weight_lbs, shipment_id, created_by_role, received_at$q$, _vul, _mij));
  if _rij ->> 'measured_weight_lbs' is not null or _rij ->> 'shipment_id' is not null
     or _rij ->> 'received_at' is not null or _rij ->> 'created_by_role' <> 'customer'
     or not exists (select 1 from public.shipment_statuses s
                    where s.code = _rij ->> 'status' and s.stage = 'registered') then
    perform pg_temp.rls_fout('kon bij aanmelden status, gewicht of zending zelf zetten: ' || _rij::text);
  end if;

  -- RPC's van G&R met echte argumenten: altijd 42501.
  for _r in
    select replace(replace(t.wat, _vul, _mij), '{ander}', _ander) as wat,
           replace(replace(t.q, _vul, _mij), '{ander}', _ander) as q
    from (values
      ('change_order_status (status zetten)',
       $q$select * from public.change_order_status(array[pg_temp.rls_id('order {mij}2')], 'ready_for_pickup', null, null)$q$),
      ('receive_order', $q$select * from public.receive_order(pg_temp.rls_id('order {mij}2'), 1)$q$),
      ('pickup_override',
       $q$select * from public.pickup_override(array[pg_temp.rls_id('order {mij}1')], 'picked_up', 'RLS', 'RLS', null)$q$),
      ('keep_order_after_cancellation_request',
       $q$select public.keep_order_after_cancellation_request(pg_temp.rls_id('order {mij}2'), null)$q$),
      ('issue_invoice', $q$select public.issue_invoice(pg_temp.rls_id('concept {mij}'))$q$),
      ('record_payment', $q$select * from public.record_payment(pg_temp.rls_id('factuur {mij}'), 1)$q$),
      ('void_payment', $q$select * from public.void_payment(pg_temp.rls_id('betaling {mij}1'), 'RLS')$q$),
      ('cancel_invoice', $q$select public.cancel_invoice(pg_temp.rls_id('factuur {mij}'), 'RLS')$q$),
      ('apply_late_fee', $q$select public.apply_late_fee(pg_temp.rls_id('factuur {mij}'))$q$),
      ('set_user_role (zichzelf beheerder maken)', $q$select public.set_user_role(auth.uid(), 'admin', true)$q$),
      ('change_customer_code (eigen code)',
       $q$select public.change_customer_code(pg_temp.rls_id('klant {mij}'), 'GR00001', 'RLS')$q$),
      ('create_customer', $q$select public.create_customer('RLS Nieuw', '+597 0000000')$q$),
      ('set_invoice_counter', $q$select public.set_invoice_counter(2099, 1)$q$),
      ('set_next_customer_number', $q$select public.set_next_customer_number(99999)$q$),
      ('peek_next_customer_number', $q$select public.peek_next_customer_number()$q$),
      ('team_members', $q$select * from public.team_members()$q$),
      ('log_recovery_link (resetlink voor klant {ander})',
       $q$select public.log_recovery_link(pg_temp.rls_id('gebruiker {ander}'))$q$),
      ('log_team_login_change',
       $q$select public.log_team_login_change(pg_temp.rls_id('medewerker'), true, 'RLS')$q$),
      ('customer_history_by_year voor klant {ander}',
       $q$select * from public.customer_history_by_year(pg_temp.rls_id('klant {ander}'))$q$),
      ('request_order_cancellation voor een order van klant {ander}',
       $q$select public.request_order_cancellation(pg_temp.rls_id('order {ander}2'))$q$)
    ) t(wat, q)
  loop
    perform pg_temp.rls_rpc_geweigerd(_r.wat, _r.q);
  end loop;

  -- En elke andere functie in public, met alleen NULL-argumenten.
  for _r in
    select f.naam, f.aanroep from pg_temp.rls_functies() f
    where f.naam <> all (pg_temp.rls_klantfuncties())
  loop
    perform pg_temp.rls_rpc_geweigerd(format('%s(…)', _r.naam), _r.aanroep);
  end loop;

  perform pg_temp.rls_factuur_onwijzigbaar();

  -- Medewerkers-id's staan in kolommen die de klant leest (received_by,
  -- changed_by, …); has_role() mag de klant niet vertellen wie beheerder is.
  perform pg_temp.rls_tel('weet via has_role() welke login beheerder of medewerker is',
    $q$select count(*) from (values (pg_temp.rls_id('beheerder'), 'admin'::public.app_role),
                                    (pg_temp.rls_id('medewerker'), 'staff'::public.app_role)) t(u, r)
       where public.has_role(t.u, t.r)$q$, 0);

  -- Wat een klant wél mag (bewijst dat de identiteit klopt).
  perform pg_temp.rls_lukt('wijzigt een eigen order in aanmelding',
    replace($q$update public.orders set customer_note = 'RLS-controle' where id = pg_temp.rls_id('order {mij}2')$q$, _vul, _mij), 1);
  perform pg_temp.rls_lukt('wijzigt eigen contactgegevens via update_my_contact',
    $q$select public.update_my_contact('+597 0000099', null, null, null)$q$);
  perform pg_temp.rls_lukt('vraagt de eigen historie op',
    $q$select * from public.customer_history_by_year()$q$);
end
$f$;

-- Wat het team (medewerker en beheerder) moet zien: alle testrijen.
create function pg_temp.rls_team_ziet_alles() returns void
language plpgsql as $f$
declare
  _r record;
begin
  for _r in
    select * from (values
      ('mist klantdossiers',
       $q$select count(*) from public.customers where id = any (pg_temp.rls_ids('klanten'))$q$, 4::bigint),
      ('mist orders',
       $q$select count(*) from public.orders where id = any (pg_temp.rls_ids('orders'))$q$, 5),
      ('mist orderdocumenten',
       $q$select count(*) from public.order_documents where customer_id = any (pg_temp.rls_ids('klanten'))$q$, 3),
      ('mist bestanden in storage',
       $q$select count(*) from storage.objects
          where bucket_id = 'order-documents' and name in (pg_temp.rls_pad('A'), pg_temp.rls_pad('B'), pg_temp.rls_pad('C'))$q$, 3),
      ('mist zendingen',
       $q$select count(*) from public.shipments where id in (pg_temp.rls_id('zending A'), pg_temp.rls_id('zending B'))$q$, 2),
      ('mist statusgeschiedenis',
       $q$select count(*) from public.shipment_status_history where order_id = any (pg_temp.rls_ids('orders'))$q$,
       pg_temp.rls_verwacht('team.historie')),
      ('mist facturen (ook concepten)',
       $q$select count(*) from public.invoices where id = any (pg_temp.rls_ids('facturen'))$q$, 5),
      ('mist factuurregels',
       $q$select count(*) from public.invoice_items where invoice_id = any (pg_temp.rls_ids('facturen'))$q$, 5),
      ('mist betalingen (ook ongedaan gemaakte)',
       $q$select count(*) from public.payments where invoice_id = any (pg_temp.rls_ids('facturen'))$q$, 4),
      ('mist facturen in invoice_overview',
       $q$select count(*) from public.invoice_overview where id = any (pg_temp.rls_ids('facturen'))$q$, 5),
      ('mist interne notities',
       $q$select count(*) from public.internal_notes where customer_id = any (pg_temp.rls_ids('klanten'))$q$,
       pg_temp.rls_verwacht('team.notities')),
      ('mist uitnodigingen',
       $q$select count(*) from public.invitations where id = pg_temp.rls_id('uitnodiging D')$q$, 1),
      ('mist e-maillogs',
       $q$select count(*) from public.email_logs where id in (pg_temp.rls_id('e-mail A'), pg_temp.rls_id('e-mail B'))$q$, 2),
      ('mist taakruns', $q$select count(*) from public.job_runs where id = pg_temp.rls_id('taakrun')$q$, 1),
      ('mist staff-taken',
       $q$select count(*) from public.staff_tasks
          where customer_id = any (pg_temp.rls_ids('klanten')) or order_id = any (pg_temp.rls_ids('orders'))$q$,
       pg_temp.rls_verwacht('team.taken')),
      ('mist profielen',
       $q$select count(*) from public.profiles where id = any (pg_temp.rls_ids('gebruikers'))$q$, 5)
    ) t(wat, q, n)
  loop
    perform pg_temp.rls_tel(_r.wat, _r.q, _r.n);
  end loop;
end
$f$;

-- Alles in public (tabellen en views) moet voor deze identiteit leeg zijn.
create function pg_temp.rls_ziet_niets() returns void
language plpgsql as $f$
declare
  _r record;
begin
  for _r in
    select c.relname::text as naam
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm')
    order by 1
  loop
    perform pg_temp.rls_tel(format('ziet rijen in public.%s', _r.naam),
      format('select count(*) from public.%I', _r.naam), 0);
  end loop;
  perform pg_temp.rls_tel('ziet bestanden in storage (order-documents)',
    $q$select count(*) from storage.objects where bucket_id = 'order-documents'$q$, 0);
end
$f$;

grant execute on all functions in schema pg_temp to public;

-- =============================================================================
-- 2. Testgegevens (als postgres; de triggers zien wel de juiste gebruiker via
--    request.jwt.claims, dus alles loopt door dezelfde controles als in de app)
-- =============================================================================

-- 2.1 Niets van deze test mag al bestaan (anders is ooit een run gecommit).
select pg_temp.rls_als('systeem');
do $$
begin
  if exists (select 1 from auth.users u
             where u.id = any (pg_temp.rls_ids('gebruikers'))
                or lower(u.email) in ('rls-klant-a@example.com', 'rls-klant-b@example.com',
                  'rls-klant-c@example.com', 'rls-klant-d@example.com',
                  'rls-medewerker@example.com', 'rls-beheerder@example.com'))
     or exists (select 1 from public.customers c
                where c.id = any (pg_temp.rls_ids('klanten')) or c.customer_number between 99991 and 99994
                   or c.email like 'rls-klant-_@example.com')
     or exists (select 1 from private.retired_customer_numbers r where r.customer_number between 99991 and 99994)
     or exists (select 1 from public.shipments s where upper(s.shipment_number) like 'RLS-ZENDING-_') then
    perform pg_temp.rls_fout('er bestaan al testgegevens van een eerdere RLS-controle '
      || '(rls-…@example.com, GR99991–GR99994 of zending RLS-ZENDING-…); verwijder die eerst');
  end if;
  if not exists (select 1 from storage.buckets b where b.id = 'order-documents') then
    perform pg_temp.rls_fout('bucket order-documents ontbreekt: zijn alle migraties toegepast?');
  end if;
end
$$;

-- 2.2 Logins (eerst onbevestigd, zodat de sign-uptrigger geen klantnummer
-- uitgeeft), rollen en klantdossiers, daarna bevestigen.
insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', pg_temp.rls_id('gebruiker A'), 'authenticated', 'authenticated',
   'rls-klant-a@example.com', '{"provider":"email","providers":["email"]}', '{"full_name":"RLS Klant A"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', pg_temp.rls_id('gebruiker B'), 'authenticated', 'authenticated',
   'rls-klant-b@example.com', '{"provider":"email","providers":["email"]}', '{"full_name":"RLS Klant B"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', pg_temp.rls_id('gebruiker C'), 'authenticated', 'authenticated',
   'rls-klant-c@example.com', '{"provider":"email","providers":["email"]}', '{"full_name":"RLS Klant C"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', pg_temp.rls_id('medewerker'), 'authenticated', 'authenticated',
   'rls-medewerker@example.com', '{"provider":"email","providers":["email"]}', '{"full_name":"RLS Medewerker"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', pg_temp.rls_id('beheerder'), 'authenticated', 'authenticated',
   'rls-beheerder@example.com', '{"provider":"email","providers":["email"]}', '{"full_name":"RLS Beheerder"}', now(), now());

insert into public.user_roles (user_id, role)
values (pg_temp.rls_id('medewerker'), 'staff'), (pg_temp.rls_id('beheerder'), 'admin');

insert into public.customers (id, user_id, customer_number, full_name, email, phone, account_type, company_name, status)
values
  (pg_temp.rls_id('klant A'), pg_temp.rls_id('gebruiker A'), 99991, 'RLS Klant A', 'rls-klant-a@example.com',
   '+597 0000001', 'personal', null, 'active'),
  (pg_temp.rls_id('klant B'), pg_temp.rls_id('gebruiker B'), 99992, 'RLS Klant B', 'rls-klant-b@example.com',
   '+597 0000002', 'business', 'RLS Bedrijf B N.V.', 'active'),
  (pg_temp.rls_id('klant C'), pg_temp.rls_id('gebruiker C'), 99993, 'RLS Klant C', 'rls-klant-c@example.com',
   '+597 0000003', 'personal', null, 'active'),
  (pg_temp.rls_id('klant D'), null, 99994, 'RLS Klant D', 'rls-klant-d@example.com',
   '+597 0000004', 'personal', null, 'invited');

update auth.users set email_confirmed_at = now() where id = any (pg_temp.rls_ids('gebruikers'));

-- Binnen deze transactie: luchtvracht aan, en een interne status die klanten
-- niet zien (om de zichtbaarheidsregel van de statusgeschiedenis te testen).
update public.service_rates set enabled = true where service_type = 'air' and not enabled;
-- Een beheerder kan het maximum aan openstaande aanmeldingen laag zetten
-- (/admin/instellingen); de testklanten melden er hier een paar aan.
update public.company_settings
   set max_open_orders_per_customer = greatest(max_open_orders_per_customer, 50)
 where id;
insert into public.shipment_statuses
  (code, label_nl, customer_description_nl, stage, sort_order, is_terminal, customer_visible, notify_customer, active)
values ('rls_intern', 'RLS intern', 'RLS-controle', 'registered', 9999, false, false, false, true);

-- 2.3 Orders, aangemeld door de klanten zelf.
select pg_temp.rls_als('klant A');
insert into public.orders (id, customer_id, order_type, store_vendor, vendor_order_number, description, tracking_number, carrier)
values
  (pg_temp.rls_id('order A1'), pg_temp.rls_id('klant A'), 'personal', 'Amazon', 'RLS-A1', 'RLS-controle', '1ZRLSA1', 'UPS'),
  (pg_temp.rls_id('order A2'), pg_temp.rls_id('klant A'), 'b2b', 'eBay', 'RLS-A2', 'RLS-controle', null, null);
select pg_temp.rls_als('klant B');
insert into public.orders (id, customer_id, order_type, store_vendor, vendor_order_number, description, tracking_number, carrier)
values
  (pg_temp.rls_id('order B1'), pg_temp.rls_id('klant B'), 'b2b', 'Amazon', 'RLS-B1', 'RLS-controle', '1ZRLSB1', 'UPS'),
  (pg_temp.rls_id('order B2'), pg_temp.rls_id('klant B'), 'personal', 'eBay', 'RLS-B2', 'RLS-controle', null, null);
select pg_temp.rls_als('klant C');
insert into public.orders (id, customer_id, order_type, store_vendor, vendor_order_number, description)
values (pg_temp.rls_id('order C1'), pg_temp.rls_id('klant C'), 'personal', 'Amazon', 'RLS-C1', 'RLS-controle');

-- 2.4 Uploads zoals de browser ze doet: als de klant zelf (authenticated).
select pg_temp.rls_als('klant A');
set local role authenticated;
select pg_temp.rls_upload('A', 'purchase_invoice');
-- Klant A vraagt ook annulering van order A2 aan (dat maakt een staff-taak).
select public.request_order_cancellation(pg_temp.rls_id('order A2'));
reset role;
select pg_temp.rls_als('klant B');
set local role authenticated;
select pg_temp.rls_upload('B', 'commercial_invoice');
reset role;
select pg_temp.rls_als('klant C');
set local role authenticated;
select pg_temp.rls_upload('C', 'other');
reset role;

-- 2.5 Het werk van de medewerker en de beheerder.
select pg_temp.rls_als('medewerker');
insert into public.shipments (id, shipment_number, service_type)
values (pg_temp.rls_id('zending A'), 'RLS-ZENDING-A', 'air'), (pg_temp.rls_id('zending B'), 'RLS-ZENDING-B', 'air');
select * from public.receive_order(pg_temp.rls_id('order A1'), 10);
select * from public.receive_order(pg_temp.rls_id('order B1'), 8);
select * from public.receive_order(pg_temp.rls_id('order C1'), 5);
update public.orders set shipment_id = pg_temp.rls_id('zending A') where id = pg_temp.rls_id('order A1');
update public.orders set shipment_id = pg_temp.rls_id('zending B') where id = pg_temp.rls_id('order B1');
select * from public.change_order_status(
  array[pg_temp.rls_id('order A2'), pg_temp.rls_id('order B2')], 'rls_intern', null, null);
insert into public.internal_notes (id, customer_id, order_id, body)
values (pg_temp.rls_id('notitie A'), pg_temp.rls_id('klant A'), pg_temp.rls_id('order A1'), 'RLS-controle: interne notitie A'),
       (pg_temp.rls_id('notitie B'), pg_temp.rls_id('klant B'), pg_temp.rls_id('order B1'), 'RLS-controle: interne notitie B');
insert into public.invoices (id, customer_id, currency)
values (pg_temp.rls_id('factuur A'), pg_temp.rls_id('klant A'), 'USD'),
       (pg_temp.rls_id('concept A'), pg_temp.rls_id('klant A'), 'USD'),
       (pg_temp.rls_id('factuur B'), pg_temp.rls_id('klant B'), 'USD'),
       (pg_temp.rls_id('concept B'), pg_temp.rls_id('klant B'), 'USD'),
       (pg_temp.rls_id('factuur C'), pg_temp.rls_id('klant C'), 'USD');
insert into public.invoice_items (id, invoice_id, order_id, line_type, description, weight_lbs, rate_per_lb, amount, vat_exempt)
values
  (pg_temp.rls_id('regel A'), pg_temp.rls_id('factuur A'), pg_temp.rls_id('order A1'), 'freight', 'RLS vracht A1', 10, 4.50, 45.00, false),
  (pg_temp.rls_id('conceptregel A'), pg_temp.rls_id('concept A'), null, 'service_fee', 'RLS servicekosten', null, null, 15.00, false),
  (pg_temp.rls_id('regel B'), pg_temp.rls_id('factuur B'), pg_temp.rls_id('order B1'), 'freight', 'RLS vracht B1', 8, 4.50, 36.00, false),
  (pg_temp.rls_id('conceptregel B'), pg_temp.rls_id('concept B'), null, 'service_fee', 'RLS servicekosten', null, null, 15.00, false),
  (pg_temp.rls_id('regel C'), pg_temp.rls_id('factuur C'), pg_temp.rls_id('order C1'), 'freight', 'RLS vracht C1', 5, 4.50, 22.50, false);
select invoice_number from public.issue_invoice(pg_temp.rls_id('factuur A'));
select invoice_number from public.issue_invoice(pg_temp.rls_id('factuur B'));
select invoice_number from public.issue_invoice(pg_temp.rls_id('factuur C'));
insert into public.payments (id, invoice_id, amount, method)
values (pg_temp.rls_id('betaling A1'), pg_temp.rls_id('factuur A'), 10, 'cash'),
       (pg_temp.rls_id('betaling A2'), pg_temp.rls_id('factuur A'), 5, 'cash'),
       (pg_temp.rls_id('betaling B1'), pg_temp.rls_id('factuur B'), 10, 'cash'),
       (pg_temp.rls_id('betaling B2'), pg_temp.rls_id('factuur B'), 5, 'cash');
insert into public.invitations (id, kind, customer_id, email, token_hash)
values (pg_temp.rls_id('uitnodiging D'), 'customer', pg_temp.rls_id('klant D'), 'rls-klant-d@example.com',
        encode(sha256(convert_to('rls-controle-uitnodiging-d', 'UTF8')), 'hex'));

select pg_temp.rls_als('beheerder');
select * from public.void_payment(pg_temp.rls_id('betaling A2'), 'RLS-controle');
select * from public.void_payment(pg_temp.rls_id('betaling B2'), 'RLS-controle');
update public.customers set status = 'disabled', disabled_reason = 'RLS-controle' where id = pg_temp.rls_id('klant C');

-- Wat de server met de service role schrijft.
select pg_temp.rls_als('systeem');
insert into public.email_logs (id, kind, customer_id, invoice_id, recipient, idempotency_key, status)
values (pg_temp.rls_id('e-mail A'), 'invoice_issued', pg_temp.rls_id('klant A'), pg_temp.rls_id('factuur A'),
        'rls-klant-a@example.com', 'rls-controle:e-mail-a', 'skipped_no_provider'),
       (pg_temp.rls_id('e-mail B'), 'invoice_issued', pg_temp.rls_id('klant B'), pg_temp.rls_id('factuur B'),
        'rls-klant-b@example.com', 'rls-controle:e-mail-b', 'skipped_no_provider');
insert into public.job_runs (id, job, trigger, status, finished_at)
values (pg_temp.rls_id('taakrun'), 'rls_controle', 'manual', 'succeeded', now());

-- 2.6 Klopt de opzet? Anders zouden controles iets bewijzen wat er niet is.
do $$
declare
  _staat text;
begin
  select string_agg(format('%s=%s', i.id, i.status), ', ' order by i.id) into _staat
  from public.invoices i where i.id = any (pg_temp.rls_ids('facturen'));
  if _staat is distinct from format('%s=partially_paid, %s=draft, %s=partially_paid, %s=draft, %s=open',
       pg_temp.rls_id('factuur A'), pg_temp.rls_id('concept A'), pg_temp.rls_id('factuur B'),
       pg_temp.rls_id('concept B'), pg_temp.rls_id('factuur C')) then
    perform pg_temp.rls_fout('voorbereiding: facturen staan niet zoals bedoeld: ' || coalesce(_staat, '-'));
  end if;
  if (select count(*) from public.customers c
      where c.id = any (pg_temp.rls_ids('klanten'))
        and (c.status, c.user_id is null) in (('active', false), ('disabled', false), ('invited', true))) <> 4
     or (select c.status from public.customers c where c.id = pg_temp.rls_id('klant C')) <> 'disabled' then
    perform pg_temp.rls_fout('voorbereiding: klantdossiers staan niet zoals bedoeld');
  end if;
  if (select count(*) from public.order_documents d where d.customer_id = any (pg_temp.rls_ids('klanten'))) <> 3
     or (select count(*) from public.orders o where o.id = any (pg_temp.rls_ids('orders')) and o.received_at is not null) <> 3
     or not exists (select 1 from public.staff_tasks t where t.order_id = pg_temp.rls_id('order A2')) then
    perform pg_temp.rls_fout('voorbereiding: orders, documenten of taken staan niet zoals bedoeld');
  end if;

  perform set_config('rls.verwacht', jsonb_build_object(
    'A.historie', (select count(*) from public.shipment_status_history h
                     join public.shipment_statuses s on s.code = h.to_status
                    where h.order_id in (pg_temp.rls_id('order A1'), pg_temp.rls_id('order A2')) and s.customer_visible),
    'B.historie', (select count(*) from public.shipment_status_history h
                     join public.shipment_statuses s on s.code = h.to_status
                    where h.order_id in (pg_temp.rls_id('order B1'), pg_temp.rls_id('order B2')) and s.customer_visible),
    'team.historie', (select count(*) from public.shipment_status_history h
                       where h.order_id = any (pg_temp.rls_ids('orders'))),
    'team.notities', (select count(*) from public.internal_notes n
                       where n.customer_id = any (pg_temp.rls_ids('klanten'))),
    'team.taken', (select count(*) from public.staff_tasks t
                    where t.customer_id = any (pg_temp.rls_ids('klanten')) or t.order_id = any (pg_temp.rls_ids('orders'))),
    'beheer.audit', (select count(*) from public.audit_log a
                      where a.record_id = any (pg_temp.rls_ids('klanten')::text[] || pg_temp.rls_ids('orders')::text[]
                                               || pg_temp.rls_ids('facturen')::text[])),
    'beheer.tellers', (select count(*) from public.invoice_number_counters)
  )::text, true);
  if pg_temp.rls_verwacht('A.historie') < 1 or pg_temp.rls_verwacht('team.historie') <= pg_temp.rls_verwacht('A.historie')
     or pg_temp.rls_verwacht('team.taken') < 1 or pg_temp.rls_verwacht('beheer.audit') < 1 then
    perform pg_temp.rls_fout('voorbereiding: geschiedenis, taken of auditlog ontbreken: ' || current_setting('rls.verwacht'));
  end if;

  perform set_config('rls.factuur_a', pg_temp.rls_vingerafdruk(pg_temp.rls_id('factuur A')), true);
end
$$;

-- =============================================================================
-- 3. CONTROLES (vanaf hier wordt alleen nog gecontroleerd)
-- =============================================================================

-- 3.1 De opzet van de database zelf.
select pg_temp.rls_als('systeem');
do $$
declare
  _r record;
begin
  for _r in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity
  loop
    perform pg_temp.rls_fout(format('tabel public.%s heeft geen row level security', _r.relname));
  end loop;
  for _r in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'v'
      and not coalesce(c.reloptions @> array['security_invoker=true'], false)
  loop
    perform pg_temp.rls_fout(format('view public.%s draait niet met security_invoker', _r.relname));
  end loop;
  for _r in
    select p.tablename, p.policyname from pg_policies p
    where p.schemaname = 'public' and p.roles && array['anon', 'public']::name[]
  loop
    perform pg_temp.rls_fout(format('policy %s op public.%s geldt voor anon of public', _r.policyname, _r.tablename));
  end loop;
  if has_schema_privilege('anon', 'private', 'usage') or has_schema_privilege('authenticated', 'private', 'usage') then
    perform pg_temp.rls_fout('schema private is bereikbaar voor anon of authenticated');
  end if;
  for _r in
    select f.naam from pg_temp.rls_functies() f
    where f.naam <> 'public_company_info'
      and has_function_privilege('anon', f.fn, 'execute')
  loop
    perform pg_temp.rls_fout(format('anon mag public.%s aanroepen', _r.naam));
  end loop;
  for _r in
    select f.naam from pg_temp.rls_functies() f
    where has_function_privilege('authenticated', f.fn, 'execute')
      and f.naam <> all (pg_temp.rls_klantfuncties() || pg_temp.rls_teamfuncties() || pg_temp.rls_beheerfuncties())
  loop
    perform pg_temp.rls_fout(format('public.%s is aan te roepen door ingelogde gebruikers maar staat niet in deze '
      || 'controle: zet hem in rls_klantfuncties, rls_teamfuncties of rls_beheerfuncties', _r.naam));
  end loop;
  for _r in
    select f.naam from pg_temp.rls_functies() f
    where f.naam = any (pg_temp.rls_serverfuncties())
      and has_function_privilege('authenticated', f.fn, 'execute')
  loop
    perform pg_temp.rls_fout(format('public.%s is alleen voor de server, maar ingelogde gebruikers mogen hem aanroepen', _r.naam));
  end loop;
end
$$;

-- 3.2 Klant A.
reset role;
select pg_temp.rls_als('klant A');
set local role authenticated;
select pg_temp.rls_klant('A', 'B');

-- 3.3 Klant B (dezelfde controles, omgekeerd).
reset role;
select pg_temp.rls_als('klant B');
set local role authenticated;
select pg_temp.rls_klant('B', 'A');

-- 3.4 Klant C (gedeactiveerd): ziet niets en kan niets.
reset role;
select pg_temp.rls_als('klant C');
set local role authenticated;
do $$
declare
  _r record;
begin
  perform pg_temp.rls_ik_ben('authenticated', 'gebruiker C');
  perform pg_temp.rls_tel('current_customer_id() is niet leeg',
    $q$select count(*) where public.current_customer_id() is not null$q$, 0);
  perform pg_temp.rls_ziet_niets();
  perform pg_temp.rls_tel('kan nog uploaden bij de eigen order',
    $q$select count(*) where public.can_upload_order_object(pg_temp.rls_pad('C'))$q$, 0);
  for _r in
    select * from (values
      ('update_my_contact', $q$select public.update_my_contact('+597 0000098', null, null, null)$q$),
      ('request_order_cancellation', $q$select public.request_order_cancellation(pg_temp.rls_id('order C1'))$q$),
      ('customer_history_by_year', $q$select * from public.customer_history_by_year()$q$)
    ) t(wat, q)
  loop
    perform pg_temp.rls_rpc_geweigerd(_r.wat, _r.q);
  end loop;
  for _r in
    select * from (values
      ('meldt een order aan',
       $q$insert into public.orders (customer_id, store_vendor) values (pg_temp.rls_id('klant C'), 'RLS')$q$),
      ('activeert zichzelf',
       $q$update public.customers set status = 'active' where id = pg_temp.rls_id('klant C')$q$),
      ('uploadt een bestand',
       $q$insert into storage.objects (bucket_id, name) values ('order-documents',
          pg_temp.rls_id('klant C') || '/' || pg_temp.rls_id('order C1') || '/00000000-0000-4000-8000-000000000997.pdf')$q$),
      ('wijzigt het eigen profiel',
       $q$update public.profiles set display_name = 'RLS' where id = auth.uid()$q$)
    ) t(wat, q)
  loop
    perform pg_temp.rls_geweigerd(_r.wat, _r.q);
  end loop;
  perform pg_temp.rls_factuur_onwijzigbaar();
end
$$;

-- 3.5 Medewerker: ziet alles, maar geen beheerderszaken.
reset role;
select pg_temp.rls_als('medewerker');
set local role authenticated;
do $$
declare
  _r record;
begin
  perform pg_temp.rls_ik_ben('authenticated', 'medewerker');
  perform pg_temp.rls_team_ziet_alles();
  perform pg_temp.rls_tel('leest het auditlog (alleen beheerders)', $q$select count(*) from public.audit_log$q$, 0);
  perform pg_temp.rls_tel('leest factuurtellers (alleen beheerders)',
    $q$select count(*) from public.invoice_number_counters$q$, 0);
  perform pg_temp.rls_tel('ziet teamrollen van anderen',
    $q$select count(*) from public.user_roles where user_id <> auth.uid()$q$, 0);
  for _r in
    select * from (values
      ('set_user_role', $q$select public.set_user_role(pg_temp.rls_id('gebruiker A'), 'staff', true)$q$),
      ('change_customer_code', $q$select public.change_customer_code(pg_temp.rls_id('klant A'), 'GR99990', 'RLS')$q$),
      ('void_payment', $q$select * from public.void_payment(pg_temp.rls_id('betaling A1'), 'RLS')$q$),
      ('cancel_invoice', $q$select public.cancel_invoice(pg_temp.rls_id('factuur A'), 'RLS')$q$),
      ('apply_late_fee', $q$select public.apply_late_fee(pg_temp.rls_id('factuur A'))$q$),
      ('set_invoice_counter', $q$select public.set_invoice_counter(2099, 1)$q$),
      ('set_next_customer_number', $q$select public.set_next_customer_number(99999)$q$),
      ('log_team_login_change', $q$select public.log_team_login_change(pg_temp.rls_id('beheerder'), true, 'RLS')$q$),
      ('log_recovery_link (resetlink voor een teamlid)',
       $q$select public.log_recovery_link(pg_temp.rls_id('beheerder'))$q$)
    ) t(wat, q)
  loop
    perform pg_temp.rls_rpc_geweigerd(_r.wat, _r.q);
  end loop;
  for _r in
    select f.naam, f.aanroep from pg_temp.rls_functies() f
    where f.naam = any (pg_temp.rls_beheerfuncties() || pg_temp.rls_serverfuncties())
  loop
    perform pg_temp.rls_rpc_geweigerd(format('%s(…)', _r.naam), _r.aanroep);
  end loop;
  for _r in
    select * from (values
      ('deactiveert een klant',
       $q$update public.customers set status = 'disabled' where id = pg_temp.rls_id('klant B')$q$),
      ('wijzigt bedrijfsinstellingen',
       $q$update public.company_settings set public_signup_enabled = not public_signup_enabled$q$),
      ('wijzigt een bankrekening', $q$update public.company_bank_accounts set account_number = 'RLS'$q$),
      ('wijzigt een status', $q$update public.shipment_statuses set label_nl = 'RLS'$q$),
      ('geeft zichzelf de beheerdersrol',
       $q$insert into public.user_roles (user_id, role) values (auth.uid(), 'admin')$q$),
      ('nodigt een teamlid uit',
       $q$insert into public.invitations (kind, staff_role, email, token_hash)
          values ('staff', 'admin', 'rls-nieuw@example.com', repeat('1', 64))$q$),
      ('schrijft het auditlog',
       $q$insert into public.audit_log (table_name, record_id, action) values ('orders', 'x', 'UPDATE')$q$),
      ('verwijdert een interne notitie',
       $q$delete from public.internal_notes where id = pg_temp.rls_id('notitie A')$q$)
    ) t(wat, q)
  loop
    perform pg_temp.rls_geweigerd(_r.wat, _r.q);
  end loop;
  perform pg_temp.rls_factuur_onwijzigbaar();
  -- Wat een medewerker wél mag.
  perform pg_temp.rls_lukt('wijzigt een order',
    $q$update public.orders set measured_weight_lbs = 11 where id = pg_temp.rls_id('order A1')$q$, 1);
  perform pg_temp.rls_lukt('boekt een betaling',
    $q$select * from public.record_payment(pg_temp.rls_id('factuur A'), 1)$q$, 1);
  perform pg_temp.rls_lukt('legt een resetlink voor klant A vast in het auditlog',
    $q$select public.log_recovery_link(pg_temp.rls_id('gebruiker A'))$q$);
  perform pg_temp.rls_tel('mist via has_role() de beheerder',
    $q$select count(*) where public.has_role(pg_temp.rls_id('beheerder'), 'admin')$q$, 1);
end
$$;

-- 3.6 Beheerder: ziet alles, ook het auditlog; ook een beheerder wijzigt geen
-- uitgegeven factuur.
reset role;
select pg_temp.rls_als('beheerder');
set local role authenticated;
do $$
begin
  perform pg_temp.rls_ik_ben('authenticated', 'beheerder');
  perform pg_temp.rls_team_ziet_alles();
  perform pg_temp.rls_tel('mist auditregels van de testgegevens',
    $q$select count(*) from public.audit_log
       where record_id = any (pg_temp.rls_ids('klanten')::text[] || pg_temp.rls_ids('orders')::text[]
                              || pg_temp.rls_ids('facturen')::text[])$q$,
    pg_temp.rls_verwacht('beheer.audit'));
  perform pg_temp.rls_tel('mist factuurtellers', $q$select count(*) from public.invoice_number_counters$q$,
    pg_temp.rls_verwacht('beheer.tellers'));
  perform pg_temp.rls_tel('mist teamrollen',
    $q$select count(*) from public.user_roles where user_id = any (pg_temp.rls_ids('gebruikers'))$q$, 2);
  perform pg_temp.rls_factuur_onwijzigbaar();
  perform pg_temp.rls_lukt('wijzigt bedrijfsinstellingen',
    $q$update public.company_settings set pickup_hours = 'RLS-controle'$q$, 1);
end
$$;

-- 3.7 Service role (de server): bypasst RLS, maar ook die wijzigt geen
-- uitgegeven factuur.
reset role;
select pg_temp.rls_als('service_role');
set local role service_role;
do $$
begin
  perform pg_temp.rls_ik_ben('service_role', null);
  perform pg_temp.rls_factuur_onwijzigbaar();
end
$$;

-- 3.8 Anon (niet ingelogd): ziet niets en mag alleen public_company_info().
reset role;
select pg_temp.rls_als('anon');
set local role anon;
do $$
declare
  _r record;
begin
  perform pg_temp.rls_ik_ben('anon', null);
  perform pg_temp.rls_ziet_niets();
  for _r in select f.naam, f.aanroep from pg_temp.rls_functies() f where f.naam <> 'public_company_info' loop
    perform pg_temp.rls_rpc_geweigerd(format('%s(…)', _r.naam), _r.aanroep);
  end loop;
  perform pg_temp.rls_tel('public_company_info() geeft geen bedrijfsgegevens',
    $q$select count(*) from public.public_company_info()$q$, 1);
  perform pg_temp.rls_geweigerd('meldt een order aan',
    $q$insert into public.orders (customer_id) values (pg_temp.rls_id('klant A'))$q$);
  perform pg_temp.rls_geweigerd('uploadt een bestand',
    $q$insert into storage.objects (bucket_id, name) values ('order-documents', 'anon/x.pdf')$q$);
end
$$;

-- 3.9 Slotcontrole: niets van het voorgaande heeft iets veranderd.
reset role;
select pg_temp.rls_als('systeem');
do $$
begin
  if pg_temp.rls_vingerafdruk(pg_temp.rls_id('factuur A')) is distinct from current_setting('rls.factuur_a') then
    perform pg_temp.rls_fout('uitgegeven factuur A, haar regels of betalingen zijn gewijzigd');
  end if;
  if (select count(*) from public.customers c
      where (c.id, c.customer_number, c.status, c.user_id, c.email) in (
        (pg_temp.rls_id('klant A'), 99991, 'active'::public.customer_status, pg_temp.rls_id('gebruiker A'), 'rls-klant-a@example.com'),
        (pg_temp.rls_id('klant B'), 99992, 'active'::public.customer_status, pg_temp.rls_id('gebruiker B'), 'rls-klant-b@example.com'),
        (pg_temp.rls_id('klant C'), 99993, 'disabled'::public.customer_status, pg_temp.rls_id('gebruiker C'), 'rls-klant-c@example.com'))) <> 3
     or not exists (select 1 from public.customers c where c.id = pg_temp.rls_id('klant D') and c.customer_number = 99994
                    and c.status = 'invited' and c.user_id is null)
     or (select count(*) from public.orders o where o.customer_id = any (pg_temp.rls_ids('klanten'))) <> 5
     or exists (select 1 from public.user_roles r where r.user_id = any (pg_temp.rls_ids('gebruikers'))
                and r.user_id not in (pg_temp.rls_id('medewerker'), pg_temp.rls_id('beheerder'))) then
    perform pg_temp.rls_fout('klantdossiers, orders of rollen zijn gewijzigd door een geweigerde poging');
  end if;
  raise notice 'ALLE RLS-CONTROLES GESLAAGD (% controles)', current_setting('rls.aantal');
end
$$;

rollback;

select 'ALLE RLS-CONTROLES GESLAAGD' as resultaat;
