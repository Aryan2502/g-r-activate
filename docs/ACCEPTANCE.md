# G&R Activate — Acceptatietest (SPEC §31)

Elke stap van SPEC §31 als vinkje: wat u precies doet (klikken en URL's), wat u moet zien,
en welk scherm of welke databaserij het bewijst. Doe de test op het **productiedomein**
nadat de go-live-checklist in `docs/DEPLOYMENT.md` tot en met "RLS check" is afgerond, en
vóór de reset (DEPLOYMENT §8.2): de reset ruimt alle testgegevens hierna weer op.

## Hoe u dit leest

Elke stap heeft een status:

- **geverifieerd met stubs/PGlite**: de ontwikkelaar heeft dit gedrag bewezen met tests:
  de echte migraties in PGlite (Postgres in het testsysteem, met dezelfde RLS en triggers),
  de echte servercode met een nagebootste Supabase, en de schermen in Chromium met
  nagebootste Supabase-antwoorden (P10 part A: elke pagina op 320–1440 px). Het bewijs
  staat erbij. Wat ontbreekt is alleen de live bevestiging: vink de stap af als u hem
  live ziet gebeuren.
- **eigenaar test live**: dit kon zonder de echte diensten niet worden bewezen (e-mail die
  echt aankomt, Supabase Auth-links, WhatsApp op een telefoon, afdrukken naar PDF). Deze
  stappen moet u zelf doen; niemand heeft ze live gezien.

Niets in dit document is live uitgevoerd door de ontwikkelaar: de live Supabase is in P10
niet aangeraakt. Wel is in de P10-audit elke stap A1–E doorlopen in Chromium tegen een
**lokale** Supabase (Supabase CLI: echte Auth, Data API, Storage, pg_cron/pg_net/Vault, de
eerste zeven migraties) met een nagebootste Resend. De daar gevonden verschillen met dit
document zijn verwerkt (A4, A15, B4). Ook dat telt niet als live: de "eigenaar test live"-
stappen blijven voor u.

## Voorbereiding

- [ ] De go-live-checklist van `docs/DEPLOYMENT.md` is afgerond tot en met "RLS check"; u
      bent beheerder (§4).
- [ ] Op `/admin/instellingen` staan: een tarief per lb voor luchtvracht (bijv. 4,50), de
      bankrekening in USD, een actief US-adres, afhaaladres en -tijden. De factuurteller
      en de volgende klantcode stelt u pas ná de reset in (zie F): de reset zet ze terug.
- [ ] Twee e-mailadressen die u zelf leest, bijvoorbeeld `uwnaam+klant1@gmail.com` en
      `uwnaam+klant2@gmail.com` (Gmail levert `+…`-adressen gewoon af), en een telefoon met
      WhatsApp.
- [ ] Twee browsers (of een gewoon en een privévenster): één als klant, één als
      beheerder. Laat ze naast elkaar open.
- [ ] Zet in elke tekst die u typt het woord **TEST**, zodat het herkenbaar is.

### Vragen voor het bewijs (SQL Editor, alleen lezen)

Supabase → SQL Editor. Vervang `<e-mail>`, `<GR-code>`, `<referentie>` en `<nummer>`.

```sql
-- Klantdossier en login
select customer_code, status, account_type, user_id is not null as heeft_login, created_at
from public.customers where email = lower('<e-mail>');

-- Orders van een klant
select o.reference, o.order_type, o.status, o.created_by_role, o.measured_weight_lbs, o.created_at
from public.orders o join public.customers c on c.id = o.customer_id
where c.customer_code = '<GR-code>' order by o.created_at;

-- Statusgeschiedenis van een order (wie, wanneer, bericht)
select h.changed_at, h.from_status, h.to_status, p.display_name as door, h.customer_message
from public.shipment_status_history h
join public.orders o on o.id = h.order_id
left join public.profiles p on p.id = h.changed_by
where o.reference = '<referentie>' order by h.id;

-- Facturen met saldo (achterstallig wordt berekend, nooit opgeslagen)
select invoice_number, status, currency, total_amount, amount_paid, balance_due, is_overdue,
       issued_at, paid_at
from public.invoice_overview
where customer_id = (select id from public.customers where customer_code = '<GR-code>')
order by created_at;

-- Regels van een factuur (D3/D5: wat de bouwer opsloeg)
select li.sort_order, li.line_type, li.description, li.weight_lbs, li.rate_per_lb, li.amount
from public.invoice_items li join public.invoices i on i.id = li.invoice_id
where i.invoice_number = '<nummer>' order by li.sort_order, li.created_at;

-- Betalingen van een factuur
select p.amount, p.paid_on, p.method, p.voided_at, p.void_reason
from public.payments p join public.invoices i on i.id = p.invoice_id
where i.invoice_number = '<nummer>' order by p.created_at;

-- E-mails die de app verstuurde of oversloeg
select created_at, kind, status, recipient, error
from public.email_logs order by created_at desc limit 20;

-- Uitnodigingen (alleen de hash van de link staat in de database, nooit de link)
select email, created_at, last_sent_at, send_count, expires_at, accepted_at, revoked_at
from public.invitations order by created_at desc limit 10;

-- Laatste auditregels
select occurred_at, table_name, action, changed_columns, reason
from public.audit_log order by id desc limit 20;
```

---

## A. Klantflow

### A1. Klant maakt een account aan

- [ ] **Doen:** open `https://<prod-domain>/` → **Account aanmaken** → `/registreren`. Vul in:
      Volledige naam "TEST Klant Een", Telefoon / WhatsApp (uw nummer, +597 staat al
      klaar), E-mailadres (adres 1), Wachtwoord (minimaal 8 tekens), Soort account
      **Particulier**, vink "Ik ga akkoord met de algemene voorwaarden" aan → **Account
      aanmaken**.
- **Verwacht:** het scherm **Controleer uw inbox** ("Wij hebben een e-mail gestuurd
  naar …"). In de inbox: "Bevestig uw e-mailadres – G&R Solutions" met het G&R-logo. De
  knop opent `https://<prod-domain>/auth/confirm?…`; daar **Doorgaan** → u bent ingelogd
  en komt op `/portal`.
- **Bewijs:** Supabase → Authentication → Users: het adres met "Confirmed"; vraag
  "Klantdossier en login" geeft één rij, `status = active`, `heeft_login = true`.
- **Status:** eigenaar test live (de bevestigingsmail en de Supabase Auth-link). Met
  stubs/PGlite bewezen: het formulier en de foutmeldingen (`src/routes/_auth`, tests
  `schemas`, `auth-errors`, `callback`), en dat het klantdossier pas ontstaat na
  bevestiging (`m1_identity.test.ts`, `customers_contract.test.ts`: handle_new_user).
- Staat registreren uit (DEPLOYMENT §3.2), dan toont `/registreren` "Registreren is niet
  mogelijk"; zet het voor deze test aan of gebruik flow B.

### A2. Het systeem geeft een GRXXXXX-code

- [ ] **Doen:** kijk op `/portal` naar **Uw klantcode**.
- **Verwacht:** `GR` plus 5 cijfers, vanaf GR00100 (de beheerderslogin van DEPLOYMENT §4
  heeft er al één gekregen, dus waarschijnlijk GR00101). **Klantcode kopiëren** zet hem
  op het klembord.
- **Bewijs:** vraag "Klantdossier en login": `customer_code`; "Laatste auditregels": een
  `customers`-regel `INSERT`.
- **Status:** geverifieerd met stubs/PGlite (`m1_identity.test.ts`: nummer uit de
  database-reeks, uniek ook bij gelijktijdige registraties, nooit hergebruikt;
  `src/lib/admin/customers.test.ts`: een code vinden hoe hij ook getypt is).

### A3. Klant logt in

- [ ] **Doen:** **Uitloggen** → `/login` → e-mailadres en wachtwoord →
      **Inloggen**.
- **Verwacht:** melding "U bent ingelogd." en het dashboard `/portal`. Een fout
  wachtwoord geeft "Onjuist e-mailadres of wachtwoord."
- **Bewijs:** Authentication → Users: "Last sign in" is bijgewerkt.
- **Status:** eigenaar test live (echte Supabase Auth). Met stubs bewezen: het
  loginscherm, de doorverwijzing naar `/portal` (klant) of `/admin` (team) en
  `?redirect=` (tests `guards`, `redirect`, `roles`, `app-routing`).

### A4. Klant ziet het dashboard

- [ ] **Doen:** bekijk `/portal`.
- **Verwacht:** "Welkom, TEST" (het portaal groet met het eerste woord van de naam; met de
  naam "TEST Klant Een" uit A1 is dat "TEST"); de eerste kaart **Uw persoonlijk
  US-verzendadres** met uw naam en code ingevuld, kopieerknoppen en de regel "Zet altijd
  uw klantcode GR… achter uw naam én op adresregel 2."; de tegels Orders (0),
  Openstaande facturen, Zendingen onderweg, Klaar voor afhalen; "Nog geen orders" met
  **Order aanmelden**.
- **Bewijs:** het scherm; de cijfers komen uit de database (er staat nog niets).
- **Status:** geverifieerd met stubs/PGlite (`src/lib/portal/orders.test.ts`,
  `invoices.test.ts`, `warehouse.test.ts`, `activity.test.ts`; P10 part A: laad-, leeg-
  en foutstaat op elke breedte).

### A5. Klant meldt een persoonlijke order aan

- [ ] **Doen:** **Order aanmelden** → `/portal/orders/nieuw` → **Persoonlijke order**. Vul
      in: Verzendwijze Lucht, Winkel / webshop "Amazon", Ordernummer van de winkel
      "TEST-111", Omschrijving "TEST schoenen", Aantal 1, Geschatte waarde 49,99 USD,
      Aankoopdatum vandaag; laat **Trackingnummer** leeg (er staat "Optioneel / indien
      bekend"). Kies bij **Documenten (optioneel)** een PDF. Vink "Mijn zending bevat geen
      verboden goederen" aan → **Order aanmelden**.
- **Verwacht:** "Order ORD-<jaar>-<nummer> is aangemeld", het document "Geüpload", de
  melding "Order succesvol aangemeld." en de orderpagina `/portal/orders/<id>` met status
  "Order aangemeld".
- **Status:** geverifieerd met stubs/PGlite (`register-order.test.ts`,
  `order-schema.test.ts`, `document-queue.test.ts`; `portal_contract.test.ts`: referentie
  en status komen uit de database, een andere klant invullen wordt geweigerd, het
  document landt in `{klant}/{order}/…`).

### A6. De order is opgeslagen

- [ ] **Doen:** vernieuw de pagina (F5), log uit en weer in, open **Orders**.
- **Verwacht:** de order staat er nog, met alles wat u invulde; onder documenten de PDF
  (downloaden werkt).
- **Bewijs:** vraag "Orders van een klant": één rij, `order_type = personal`,
  `status = order_registered`, `created_by_role = customer`. E-mail: "Order bevestigd"
  komt aan; vraag "E-mails": `kind = order_confirmation`, `status = sent` (zonder Resend:
  `skipped_no_provider`, zie hoofdstuk E).
- **Status:** opslaan geverifieerd met stubs/PGlite (zie A5); de e-mail: eigenaar test
  live.

### A7. Beheerder ziet de order

- [ ] **Doen:** in de beheerdersbrowser `/admin/orders` → typ in **Zoeken of scannen** de
      referentie of de GR-code → Enter.
- **Verwacht:** de order met Klant "TEST Klant Een", Type "Persoonlijk", Status "Order
  aangemeld", Factuur leeg. Op `/admin` telt "Nieuwe orders" mee.
- **Status:** geverifieerd met stubs/PGlite (`admin_contract.test.ts`,
  `src/lib/admin/orders.test.ts`: zoeken op tracking, GR-code, referentie, naam).

### A8. Beheerder wijzigt de zendingstatus

- [ ] **Doen:** bij de order **Ontvangen in US-magazijn** → Gemeten gewicht (lbs) "3,5" →
      **Ontvangen**. Daarna **Status wijzigen** → Nieuwe status "Onderweg naar Suriname" →
      Bericht voor de klant "TEST: vertrokken" → laat **Klant e-mailen** aan → **Status
      wijzigen**.
- **Verwacht:** "Order … is ontvangen in het US-magazijn.", daarna "Status van order …
  gewijzigd naar ‘Onderweg naar Suriname’." met de uitkomst van de e-mail. Zonder
  e-mail toont het venster **Klanten zelf informeren** met **Via WhatsApp**. Op de
  orderpagina: de geschiedenis met "door <uw naam>", het bericht en de tijd.
- **Bewijs:** vraag "Statusgeschiedenis": twee rijen (naar `arrived_us_warehouse` en naar
  `in_transit`), `door` = uw naam; vraag "Orders": `measured_weight_lbs = 3.50`.
- **Status:** geverifieerd met stubs/PGlite (`admin_contract.test.ts`: ontvangen,
  enkele en bulk-statuswijziging met historie "door Maria", één e-mail per klant, een
  klant kan geen status zetten; `src/lib/admin/order-actions.test.ts`: één e-mail per
  klant per actie).

### A9. Klant ziet de nieuwe status

- [ ] **Doen:** in de klantbrowser `/portal/orders/<id>` vernieuwen; daarna `/portal`.
- **Verwacht:** status "Onderweg naar Suriname", de voortgang per fase, in de
  geschiedenis "G&R Solutions" (niet de naam van de medewerker) met "TEST: vertrokken".
  Op het dashboard "Zendingen onderweg: 1". In de inbox de statusupdate.
- **Bewijs:** vraag "E-mails": `kind = status_update` (de ontvangst in het US-magazijn
  stuurt er ook één: die status mailt standaard).
- **Status:** zichtbaarheid geverifieerd met stubs/PGlite (`portal_contract.test.ts`,
  `rls_checks.sql`: klanten zien alleen zichtbare statussen van hun eigen orders); de
  e-mail: eigenaar test live.

### A10. Beheerder genereert een factuur

- [ ] **Doen:** op `/admin/orders/<id>` → **Genereer factuur** → `/admin/facturen/nieuw`.
      Controleer: klant en order zijn al gekozen, één vrachtregel "Amazon – order
      TEST-111" met Gewicht 3,5 en het tarief uit de instellingen. Rechts (scherm vanaf
      1024 px) of onder de tab **Voorbeeld**: de factuur in het G&R-sjabloon met
      "Invoicenummer: CONCEPT". **Genereer factuur** → **Factuur uitgeven?** →
      **Genereer factuur**.
- **Verwacht:** "Factuur succesvol aangemaakt." met de uitkomst van de e-mail
  ("Factuur INV-<jaar>-0001 is aangemaakt en naar de klant gemaild." of de tekst dat
  e-mail niet is ingesteld); de factuurpagina `/admin/facturen/<id>` met nummer en
  status "Openstaand".
- **Status:** geverifieerd met stubs/PGlite (`invoice_builder_contract.test.ts`: vracht
  uit het gemeten gewicht, wat het voorbeeld toont wordt opgeslagen;
  `invoice_totals.test.ts`: de totalen van het voorbeeld zijn gelijk aan die van de
  database).

### A11. De factuur is opgeslagen

- [ ] **Doen:** vernieuw; open `/admin/facturen`.
- **Verwacht:** de factuur in de lijst met nummer, klant, bedrag en "Openstaand".
- **Bewijs:** vraag "Facturen": `invoice_number = INV-<jaar>-0001` (of verder, als u de
  teller zette), `status = open`, `total_amount` = "Totaal prijs" op het voorbeeld,
  `issued_at` gevuld; vraag "E-mails": `kind = invoice_issued`.
- **Status:** geverifieerd met stubs/PGlite (`invoices_contract.test.ts`: na
  `issue_invoice` gerenderd uit de momentopnames, onveranderlijk); de e-mail: eigenaar
  test live.

### A12. Klant ziet de factuur

- [ ] **Doen:** klantbrowser → **Facturen** (`/portal/facturen`) → open de factuur →
      **Opslaan als PDF**.
- **Verwacht:** in de lijst nummer, datum, vervaldatum, order, bedrag, "Nog te betalen" en
  het label "Openstaand". De factuur zelf in het G&R-sjabloon, met **Zo betaalt u deze
  factuur**: bedrag, uiterlijk, betaalreferentie "INV-… / GR…" (kopieerknop) en de
  rekening in de factuurvaluta. **Opslaan als PDF** opent de afdrukweergave; kies daar
  "Opslaan als PDF": één pagina, logo en kleuren zichtbaar, voettekst onderaan.
- **Status:** wat de klant ziet geverifieerd met stubs/PGlite (`invoices_contract.test.ts`:
  nooit een concept, ook niet via de id; P10 part A: print-route op elke breedte);
  de PDF op een echte computer/telefoon: eigenaar test live.

### A13. Beheerder markeert de factuur als betaald

- [ ] **Doen:** `/admin/facturen/<id>` → **Markeer als betaald** → Betaaldatum vandaag,
      Betaalwijze "Overschrijving" → **Markeer als betaald**.
- **Verwacht:** status "Betaald", op het document de stempel "BETAALD dd-mm-jjjj", onder
  **Betalingen** de betaling; e-mail "betaling ontvangen".
- **Bewijs:** vraag "Betalingen": één rij voor het volledige bedrag; vraag "Facturen":
  `status = paid`, `balance_due = 0.00`, `paid_at` gevuld; vraag "E-mails":
  `kind = payment_received`.
- **Status:** geverifieerd met stubs/PGlite (`invoices_contract.test.ts`: deelbetaling,
  dan "Markeer als betaald", de status volgt de betalingen); de e-mail: eigenaar test
  live.

### A14. Klant ziet BETAALD

- [ ] **Doen:** klantbrowser `/portal/facturen` vernieuwen; filter **Betaald**; open de
      factuur; kijk op `/portal`.
- **Verwacht:** het label "Betaald" (tekst met icoon, niet alleen kleur), "Betaald op
  dd-mm-jjjj", de stempel op het document; op het dashboard "Geen openstaand bedrag".
- **Status:** geverifieerd met stubs/PGlite (`invoices_contract.test.ts`,
  `src/lib/portal/invoices.test.ts`).

### A15. Klant ziet order en factuur in de historie

- [ ] **Doen:** klantbrowser → **Historie** (`/portal/historie`) → klik op het jaar →
      klik op de order en op de factuur.
- **Verwacht:** "Per jaar" met bijv. "1 order, 1 factuur, 1 betaling"; de lijst met de
  order, de statuswijzigingen, de factuur en de betaling; elke regel opent zijn pagina.
  Zoeken op "TEST-111" (het ordernummer van de winkel uit A5) vindt de order; zoeken op de
  referentie (ORD-…) of "Amazon" ook.
- **Status:** geverifieerd met stubs/PGlite (`history_export_contract.test.ts`: de lijst
  en de jaartelling van `customer_history_by_year` komen overeen, een andere klant ziet
  niets; `src/lib/portal/history.test.ts`: zoeken op het ordernummer van de winkel, sinds
  de P10-review, daarvoor vond de historie "TEST-111" niet).

---

## B. Bestaande klant (uitnodiging met bestaande GR-code)

### B1. Beheerder nodigt een bestaande klant uit

- [ ] **Doen:** `/admin/klanten` → **Klant uitnodigen**. Vul in: Volledige naam "TEST Jan
      Bestaand", E-mailadres (adres 2), Telefoon / WhatsApp (uw nummer).
- **Verwacht:** het venster **Klant uitnodigen** met de velden Volledige naam, E-mailadres,
  Telefoon / WhatsApp en **Bestaande GR-code** (optioneel); er is nog niets opgeslagen
  (dat gebeurt pas bij **Uitnodiging maken** in B2).
- **Bewijs:** samen met B2: de rijen die B2 noemt ontstaan pas na B2.
- **Status:** geverifieerd met stubs/PGlite (`src/lib/admin/customer-actions.test.ts`
  "'Klant uitnodigen'": naam en e-mail verplicht, telefoon en code optioneel; P10 part A:
  het venster op elke breedte; de opslag: zie B2).

### B2. Beheerder vult de bestaande GR-code in

- [ ] **Doen:** in hetzelfde venster bij **Bestaande GR-code** "gr 17" (of een andere vrije
      code onder 100) → wacht op "GR00017 is vrij." → **Uitnodiging maken**.
- **Verwacht:** "Klant GR00017 TEST Jan Bestaand aangemaakt en uitgenodigd." en het venster
  **Uitnodigingslink** met de link, **Kopieer uitnodigingslink** en **Deel via
  WhatsApp**, en wat er met de e-mail gebeurde. Kopieer de link.
- **Extra:** **Klant uitnodigen** opnieuw met een ander adres en code "GR00017" → de
  melding "GR00017 is al toegewezen aan TEST Jan Bestaand".
- **Bewijs:** vraag "Klantdossier" (adres 2): `customer_code = GR00017`,
  `status = invited`, `heeft_login = false`; vraag "Uitnodigingen": één open rij; vraag
  "E-mails": `kind = invitation`.
- **Status:** geverifieerd met stubs/PGlite (`customers_contract.test.ts`, SPEC §5-
  voorbeeld "John Doe, GR00017": code gereserveerd, "gr 17" voor een ander geweigerd;
  alleen de hash van de link in de database).

### B3. Klant ontvangt de uitnodiging

- [ ] **Doen:** kijk in inbox 2, en stuur de link ook met **Deel via WhatsApp** naar uw
      telefoon.
- **Verwacht:** de e-mail met het G&R-logo en de knop naar `https://<prod-domain>/invite/…`;
  WhatsApp opent een gesprek met een Nederlandse tekst ("G&R Solutions nodigt u uit …
  Uw klantcode is GR00017 …") en dezelfde link.
- **Status:** eigenaar test live (echte e-mail en WhatsApp). De tekst en de link zijn
  geverifieerd met stubs (`src/server/invitations.test.ts`,
  `src/lib/admin/invitations.test.ts` "WhatsApp sharing", `templates.test.ts`).

### B4. Klant activeert het account

- [ ] **Doen:** open de link (bij voorkeur op de telefoon) → `/invite/<token>`.
- **Verwacht:** "Welkom bij G&R Activate, TEST" (het eerste woord van de naam "TEST Jan
  Bestaand"), het e-mailadres gemaskeerd, **Uw
  klantcode GR00017**, "Deze link is geldig tot …". Kies een wachtwoord (minimaal 8) →
  **Account activeren** → "Uw account is geactiveerd." en het dashboard `/portal`. In
  inbox 2 de welkomstmail met het persoonlijke US-adres.
- **Extra:** open dezelfde link nog eens → "Deze uitnodiging is al gebruikt".
- **Bewijs:** vraag "Uitnodigingen": `accepted_at` gevuld; vraag "Klantdossier":
  `status = active`, `heeft_login = true`; vraag "E-mails": `kind = welcome`.
- **Status:** inwisselen (paden a, b en c) geverifieerd met stubs/PGlite
  (`customers_contract.test.ts` "redemption"); met de echte Supabase Auth: eigenaar test
  live.

### B5. De bestaande GR-code blijft

- [ ] **Doen:** bekijk `/portal` als Jan; bekijk `/admin/klanten` en zoek "17".
- **Verwacht:** overal GR00017; het US-adres op het dashboard bevat "TEST Jan Bestaand
  GR00017".
- **Bewijs:** vraag "Klantdossier": nog steeds `customer_code = GR00017`.
- **Status:** geverifieerd met stubs/PGlite (`customers_contract.test.ts`: John accepteert
  als GR00017).

### B6. De klant gebruikt het portaal gewoon

- [ ] **Doen:** als Jan een order aanmelden zoals A5.
- **Verwacht:** als A5–A7; de beheerder vindt de order op "GR00017".
- **Status:** geverifieerd met stubs/PGlite (zoals A5–A7).

---

## C. B2B-flow

### C1. Klant meldt een B2B-order aan

- [ ] **Doen:** als klant 1 → **Order aanmelden** → **Zakelijke order (B2B)**. Vul naast de
      gewone velden in: Leverancier "TEST Leverancier", PO-nummer "TEST-PO-1", Inkoop
      "Zelf gekocht"; voeg bij documenten een PDF toe met soort "Commerciële factuur"
      (of juist niet: zie C4) → vink verboden goederen aan → **Order aanmelden**.
- **Verwacht:** "Order succesvol aangemeld." en de orderpagina.
- **Status:** geverifieerd met stubs/PGlite (`order-schema.test.ts`,
  `portal_contract.test.ts`: ook een B2B-inkoop door G&R zonder winkel of waarde).

### C2. De order is duidelijk B2B

- [ ] **Doen:** bekijk `/portal/orders` en de orderpagina.
- **Verwacht:** het label "Zakelijk" in de lijst; op de orderpagina "Soort order:
  Zakelijk" en het blok **Zakelijke gegevens** met leverancier en PO-nummer.
- **Bewijs:** vraag "Orders": `order_type = b2b`.
- **Status:** geverifieerd met stubs/PGlite (`src/lib/portal/orders.test.ts`,
  `order-fields.test.ts`; P10 part A).

### C3. Beheerder ziet de B2B-order

- [ ] **Doen:** `/admin/orders` → **Soort order** "Zakelijk".
- **Verwacht:** alleen zakelijke orders, met het label "Zakelijk".
- **Status:** geverifieerd met stubs/PGlite (`src/lib/admin/orders.test.ts`).

### C4. Beheerder verwerkt zending en factuur gewoon

- [ ] **Doen:** **Ontvangen in US-magazijn** (gewicht invullen) → **Status wijzigen** naar
      "Bij de douane". Zonder commerciële factuur of paklijst verschijnt de waarschuwing
      "Zakelijke order zonder douanedocumenten" (niet blokkerend) → **Status wijzigen**.
      Daarna **Genereer factuur** zoals A10 en **Markeer als betaald** zoals A13.
- **Verwacht:** als A8–A14, met de waarschuwing bij een B2B-order zonder documenten.
- **Status:** geverifieerd met stubs/PGlite (`admin_contract.test.ts`;
  `src/lib/admin/statuses.test.ts` `needsB2bCustomsWarning()`: waarschuwt vanaf de douane,
  blokkeert nooit).

---

## D. Factuurflow

### D1. Beheerder opent "Genereer factuur"

- [ ] **Doen:** `/admin/facturen` → **Factuur maken** → `/admin/facturen/nieuw`. (Ook
      mogelijk: **Genereer factuur** bij een order, bij een selectie op `/admin/orders`, of
      op de klantpagina.)
- **Status:** geverifieerd met stubs/PGlite (P6-A; P10 part A).

### D2. Beheerder kiest klant en order

- [ ] **Doen:** bij **Klant** typ de GR-code van klant 1 → kies; vink onder **Orders** een
      ontvangen order aan.
- **Verwacht:** per gekozen order één vrachtregel; orders waarvan de vracht al op een
  factuur staat, staan er alleen met de schakelaar "Ook orders tonen waarvan de vracht al
  gefactureerd is".
- **Status:** geverifieerd met stubs/PGlite (`invoice_builder_contract.test.ts`: vracht
  maar één keer per order, een order van een andere klant geweigerd).

### D3. Beheerder vult lbs en andere kosten in

- [ ] **Doen:** zet bij de vrachtregel Gewicht (lbs) op "12,5". **Regel toevoegen** →
      "Inklaringskosten / douane" Bedrag "25,00"; **Regel toevoegen** → "Handlingkosten"
      "5,00"; **Regel toevoegen** → "Korting" "2,50".
- **Verwacht:** in de bouwer vier regels: de vrachtregel met als bedrag 12,5 × het tarief
  per lb (afgerond op centen), "Inklaringskosten / douane" 25,00, "Handlingkosten" 5,00 en
  "Korting" als – 2,50 (een korting is altijd negatief); een leeg of ongeldig bedrag geeft
  een Nederlandse melding bij het veld.
- **Bewijs:** na D5 de vraag "Regels van een factuur": vier rijen met `line_type`
  freight, customs, handling en discount, `weight_lbs = 12.50` op de vrachtregel en
  `amount = -2.50` op de korting.
- **Status:** geverifieerd met stubs/PGlite (`src/lib/admin/invoice-builder.test.ts`,
  `invoice_builder_contract.test.ts`: wat de bouwer toont wordt opgeslagen; de database
  weigert een positieve korting of een vrachtbedrag dat niet gewicht × tarief is).

### D4. Het voorbeeld verandert mee

- [ ] **Verwacht:** bij elke toets verandert het voorbeeld (rechts, of onder de tab
      **Voorbeeld** onder 1024 px): "Totaal lbs 12,50 lbs", de regels "Inklaringskosten /
      douane USD 25,00", "Handlingkosten USD 5,00", "Korting – USD 2,50" en "Totaal prijs",
      met het watermerk "CONCEPT". **Vergroten** toont hem op ware grootte.
- **Status:** geverifieerd met stubs/PGlite (`invoice_totals.test.ts`: 300+ gegenereerde
  facturen, totalen van het voorbeeld = totalen van de database; `InvoiceDocument`-tests;
  de vergelijking met het Word-sjabloon in P6-A).

### D5. Beheerder genereert de factuur

- [ ] **Doen:** eerst **Opslaan als concept** (melding "Concept opgeslagen."; de factuur
      staat in `/admin/facturen` als "Concept"), dan **Genereer factuur** → **Genereer
      factuur**.
- **Verwacht:** als A10: "Factuur succesvol aangemaakt." en de factuurpagina met een
  INV-nummer en status "Openstaand"; het concept bestaat niet meer als concept.
- **Bewijs:** vraag "Facturen": `status = open`, `issued_at` gevuld; vraag "E-mails":
  `kind = invoice_issued` (of `skipped_no_provider`).
- **Status:** geverifieerd met stubs/PGlite (`invoices_contract.test.ts`: concept opslaan
  en bewerken, dan `issue_invoice`; `invoice_builder_contract.test.ts`); de e-mail:
  eigenaar test live.

### D6. De factuur is opgeslagen

- [ ] **Bewijs:** vraag "Facturen": `total_amount` is precies "Totaal prijs" van het
      voorbeeld; vernieuwen verandert niets. Een poging om de uitgegeven factuur te
      wijzigen wordt door de database geweigerd (bewezen door `rls_checks.sql`).
- **Status:** geverifieerd met stubs/PGlite (`invoices_contract.test.ts`,
  `rls_checks_script.test.ts`).

### D7. Klant ziet de factuur

- [ ] **Doen en verwacht:** als A12, voor deze factuur (met de vier regels van D3).
- **Bewijs:** het scherm `/portal/facturen/<id>`; een concept is daar nooit te zien.
- **Status:** geverifieerd met stubs/PGlite (als A12: `invoices_contract.test.ts`); de PDF:
  eigenaar test live.

### D8. Beheerder wijzigt de status

- [ ] **Doen:** **Betaling registreren** → Bedrag "10,00" → opslaan → status "Deels
      betaald". Dan **Markeer als betaald** → status "Betaald". (Alleen beheerders, als
      extra: **Betaling ongedaan maken** met een reden → weer "Deels betaald"; en op een
      andere testfactuur zonder betalingen **Factuur annuleren** met een reden →
      "Geannuleerd".)
- **Bewijs:** vraag "Betalingen" en "Facturen" (status volgt de betalingen; een
  ongedaan gemaakte betaling heeft `voided_at` en `void_reason`).
- **Status:** geverifieerd met stubs/PGlite (`invoices_contract.test.ts` "payments" en
  "admin actions").

### D9. Klant ziet de nieuwe status

- [ ] **Verwacht:** "Deels betaald" met het resterende bedrag, daarna "Betaald"; een
      ongedaan gemaakte betaling ziet de klant niet; bij een geannuleerde factuur
      "Geannuleerd" met de reden.
- **Status:** geverifieerd met stubs/PGlite (`invoices_contract.test.ts`,
  `rls_checks.sql`).

---

## E. E-mails en WhatsApp

De app mailt zelf via Resend; Supabase Auth mailt de bevestiging en het wachtwoordherstel
(via Resend als custom SMTP, DEPLOYMENT §6.3). Alleen de e-mails van de app staan in
`public.email_logs`.

| Gebeurtenis                      | E-mail (`email_logs.kind`) | Waar te zien zonder e-mail                                       |
| -------------------------------- | -------------------------- | ---------------------------------------------------------------- |
| Uitnodiging (B2), opnieuw sturen | `invitation`               | linkvenster: **Kopieer uitnodigingslink**, **Deel via WhatsApp** |
| Account geactiveerd (B4)         | `welcome`                  | (alleen e-mail)                                                  |
| Order aangemeld (A5)             | `order_confirmation`       | (alleen e-mail)                                                  |
| Statuswijziging die mailt (A8)   | `status_update`            | statusvenster: **Klanten zelf informeren** → **Via WhatsApp**    |
| Factuur uitgegeven (A10)         | `invoice_issued`           | factuurpagina: **Deel via WhatsApp**                             |
| Volledig betaald (A13)           | `payment_received`         | factuurpagina: **Deel via WhatsApp**                             |
| Herinnering (vervaldatum)        | `payment_reminder_*`       | `/admin/herinneringen`: **Herinner via WhatsApp**                |
| Registreren, wachtwoord vergeten | — (Supabase Auth)          | inbox; Supabase → Authentication → Logs                          |

Wat u per e-mail controleert:

- [ ] **Met Resend ingesteld:** de mail komt aan, van `EMAIL_FROM`, met het G&R-logo,
      Nederlandse tekst en knoppen naar `https://<prod-domain>/…`; vraag "E-mails" geeft
      `status = sent`. Een fout staat als `failed` met de reden in `error`.
- [ ] **Zonder Resend** (of als test vóór §6): er gaat niets weg, de schermen zeggen "E-mail
      is nog niet geconfigureerd", en vraag "E-mails" geeft `skipped_no_provider` (alleen
      als `SUPABASE_SERVICE_ROLE_KEY` gezet is). Dan neemt WhatsApp het over: test elke
      knop uit de tabel; op de telefoon opent een gesprek met het nummer van de klant
      (597-nummer) en een kant-en-klare Nederlandse tekst met de link.
- [ ] **Wachtwoord vergeten:** uitloggen → `/wachtwoord-vergeten` → adres 1 → **Resetlink
      versturen** → mail "Nieuw wachtwoord instellen – G&R Solutions" → **Doorgaan** op
      `/auth/confirm` → `/auth/set-password` → nieuw wachtwoord → ingelogd.
- [ ] **Resetlink door G&R** (geen e-mail): op `/admin/klanten/<id>` van klant 1
      **Wachtwoord-resetlink maken**. Daarna `/admin/audit` → Tabel
      "Wachtwoord-resetlinks": een regel met u als "Wie" en de GR-code van klant 1 (de
      link wordt pas gemaakt als die regel er is). In de kolom "Wie" staan klanten altijd
      als "Klant GR… · naam", teamleden met hun naam.
- [ ] **Herinneringen:** `/admin/herinneringen` → **Herinneringen nu versturen** → de ronde
      staat onder "Laatste rondes"; een factuur die nog niet vervalt krijgt niets.
      (De dagelijkse ronde: DEPLOYMENT §7.3.)
- **Status:** eigenaar test live. Met stubs bewezen: inhoud en escapen van elke mail
  (`templates.test.ts`), één claim per idempotentiesleutel, `skipped_no_provider` zonder
  sleutel, nooit een fout naar de gebruiker (`src/server/email.test.ts`,
  `email_contract.test.ts`), de WhatsApp-links (`src/lib/admin/invitations.test.ts`,
  `invoice-actions.test.ts`, `status-share.test.ts`, `reminders.test.ts`).

---

## F. Afronden

- [ ] Alle vinkjes hierboven staan, of wat niet lukte staat met datum en schermafbeelding
      in een lijst voor de ontwikkelaar.
- [ ] Het RLS-script nog één keer gedraaid (DEPLOYMENT §8.1), met als uitkomst
      `ALLE RLS-CONTROLES GESLAAGD`.
- [ ] Daarna de **reset** (DEPLOYMENT §8.2): alle TEST-klanten, orders, facturen,
      betalingen, e-maillogs en hun auditregels gaan weg; de nummering begint opnieuw.
- [ ] **Na de reset** de nummering opnieuw instellen: `/admin/instellingen` → Nummering →
      de factuurteller van dit jaar (als G&R zijn eigen nummers voortzet) en, als G&R een
      reeks klantcodes vrijhoudt, de **Volgende klantcode**. Controleer de zin "De volgende
      factuur krijgt INV-…": de reset zet beide terug naar INV-<jaar>-0001 en GR00100.
