# G&R Activate — Voortgang

Bron: `docs/SPEC.md` (§1–§35). §35 gaat voor bij verschillen.

## Status per sectie

Laatst bijgewerkt: P8/P9 reviewronde (2026-10-07). 17 reviewbevindingen nagelopen: alle echt;
16 opgelost, 1 deels (de "Herinneringen nu versturen"-ronde die door een tijdslimiet wordt
afgebroken: zichtbaar als "Afgebroken" en de volgende ronde ruimt op, maar een herinnering die
precies tussen het accepteren door Resend en het boeken wegvalt kan een dag later opnieuw
uitgaan; zie open punten). Herinneringen: hooguit ÉÉN herinnering per factuur per Surinaamse
dag, via welke route ook (dagelijkse ronde, "Herinneringen nu versturen", per factuur); de knop
per factuur gebruikt de sleutel van de dagelijkse ronde als die vandaag toch zou versturen (een
klik en de ronde tegelijk geven één e-mail); voorbij het maximum alleen na bevestiging; de ronde
leest de facturen per pagina en de id-lijsten in blokken van 100. WhatsApp: "Herinner via
WhatsApp" op elke openstaande factuur, en na een statuswijziging een lijst van klanten zonder
e-mail met een kant-en-klaar WhatsApp-bericht (bij ontvangen als knop in de melding).
Systeemstatus: laatste AUTOMATISCHE ronde apart, waarschuwing na 26 uur zonder, "Afgebroken"
voor een ronde die blijft hangen. pg_net: de migratie probeert niets meer in te trekken (kan
niet op Supabase); de echte afscherming is dat `net` geen API-schema is (DEPLOYMENT §7.4).
E-mails: geen "Beste klant," voor teamleden, geen "N.V..", bedragen in een eigen kolom "Bedrag",
overal "uiterlijk op". Zie "Bewijs P8/P9 reviewronde". Daarvoor P8 + P9 (2026-10-07). P8 (deel A): e-mail via de Resend REST API
(`src/server/email.ts` `sendEmail`: eerst een claim in `email_logs`, dan verzenden met
`Idempotency-Key`; zonder `RESEND_API_KEY`/`EMAIL_FROM` een regel `skipped_no_provider`, nooit
een fout), Nederlandse HTML- en tekstsjablonen voor alle §35.12-mails, alle P3–P7-haken echt
aangesloten (de UI meldt verstuurd / overgeslagen omdat e-mail niet is ingesteld / mislukt),
betalingsherinneringen (`runPaymentReminders`, cron-route `/api/cron/payment-reminders`,
`/admin/herinneringen`) en migratie `20261008090000_p8_reminders.sql` (pg_cron + pg_net, Vault,
dagelijkse job; nog NIET live toegepast), plus het opruimen van verweesde uploads in de cronronde.
P9 (deel B): `/portal/historie` (per jaar uit `customer_history_by_year`, filters jaar/soort,
zoeken, elke regel opent zijn pagina), `/admin/audit` (alleen beheerders: generieke tabel met
filters in de database en een JSON-lade), een leesbare factuurgeschiedenis op
`/admin/facturen/$id` en "Exporteer CSV" (beheerders) voor klanten, orders, facturen met regels,
betalingen en het auditlog. P9 heeft geen migratie. Zie "Bewijs P9 deel B" en "Bewijs P8 deel A".
Daarvoor P6/P7 reviewronde (2026-10-07): 17 reviewbevindingen nagelopen (alle echt;
6 en 12 zijn dezelfde): 15 opgelost, 6/12 deels (de bouwer houdt het voorbeeld naast het
formulier vanaf 1024 px zoals §35.11 zegt, met een knop "Vergroten" voor ware grootte). Factuurdocument: tot 8 regels plus
BTW-regel, opmerking, bedrijfsnaam en KKF-regel passen op één Letter-pagina; de totaalregels
horen nu bij de itemtabel (kop herhaalt op een nieuwe pagina, de laatste itemregel gaat mee);
stempel "BETAALD" in een vrije marge; footer loopt door op twee regels; meldingen (toasts)
worden nooit mee geprint. Bouwer: opslaan in een volgorde die het totaal nooit onder 0 laat
zakken, mislukte eerste opslag laat geen leeg concept achter, "Corrigeren" waarschuwt bij
weggaan en een geannuleerde factuur zonder vervanger krijgt "Vervangende factuur maken",
opslaan/uitgeven ook onder het voorbeeld (tabs), pijlen alleen waar de volgorde op papier
telt, omschrijving vooraf ingevuld. Betalingen: "1.250" wordt geweigerd i.p.v. als 1,25
geboekt, "Markeer als betaald" boekt het saldo dat de medewerker zag. Klantlijst: kolom
"Datum". Geen migratie; zie "Bewijs P6/P7 reviewronde". Daarvoor P6/P7 deel B (2026-10-07): factuurlijst `/admin/facturen` (zoeken op
nummer, klant, GR-code en orderreferentie; filters status incl. "Achterstallig" uit
`invoice_overview`, valuta en periode; sorteren; totalen per valuta), de factuurpagina
`/admin/facturen/$id` met betalingen ("Betaling registreren", "Markeer als betaald"),
"Betaling ongedaan maken", "Factuur annuleren", "Corrigeren" en "Opslag 15% toepassen"
(beheerders), herinneringsadministratie (alleen-lezen), "Deel via WhatsApp" en afdrukken/PDF;
de klantkant `/portal/facturen` en `/portal/facturen/$id` (nooit concepten, saldo per valuta,
betaalinstructie prominent, "Opslaan als PDF"); de print-routes
`/admin/facturen/$id/print` en `/portal/facturen/$id/print` (alleen het document, buiten de
app-shell); links vanaf dashboards, orders en klantpagina's; navigatie "Facturen" in beide
gebieden. Server functions `recordPaymentFn`, `markPaidFn`, `voidPaymentFn`,
`cancelInvoiceFn`, `applyLateFeeFn`, `invoiceShareFn` en P8-haak `onPaymentRecorded`. Geen
nieuwe migratie (geen gat gevonden). P6 en P7 zijn daarmee klaar; zie "Bewijs P6/P7 deel B".
Daarvoor P6/P7 deel A (2026-10-07): één factuurrenderer `InvoiceDocument` (exacte
nabouw van het Word-sjabloon, §35.11) met de modelbouwers `fromDraftForm` en
`fromIssuedInvoice`, `computeInvoiceTotals` (bewezen gelijk aan de SQL op 300+ gegenereerde
facturen), de factuurbouwer `/admin/facturen/nieuw` met live voorbeeld, concepten opslaan en
bewerken (`/admin/facturen/$id`), `issueInvoiceFn` met P8-haak en de knoppen "Genereer factuur"
op orders, de orderpagina en de klantpagina. Geen nieuwe migratie (geen gat gevonden). Deel B
(lijst, betalingen, klantpagina's, print-routes) volgt; zie "Bewijs P6/P7 deel A". Daarvoor:
P5 reviewronde (2026-10-07): 23 reviewbevindingen nagelopen (21 opgelost,
1 bewust anders opgelost, 1 dubbel), met wijzigingen in dezelfde, nog niet toegepaste migratie
`20261007150000_p5_customers.sql` (geen teamlogin bannen vanaf een klantpagina, uitnodiging van
een gedeactiveerde uitnodiger telt als ingetrokken, verstuurlimiet per e-mailadres, profielnaam
uit de uitnodiging, klantbericht bij "Order behouden", notitie bij ingetrokken uitnodigingen;
zie "Bewijs P5 reviewronde"). Daarvoor P5 deel B (2026-10-07): teampagina `/admin/team` (medewerkers uitnodigen,
rollen, logins deactiveren/activeren, resetlinks), instellingen `/admin/instellingen` (alle
secties van §35.8, bankrekeningen, US-adressen met live voorbeeld, tarieven, factuurteller en
volgende klantcode), het volledige admin-dashboard (§12-KPI's per valuta, recente activiteit,
"Nog in te stellen", Systeemstatus) en de navigatie; de P5-migratie kreeg een teamdeel
(geblokkeerde login heeft geen rol, `team_members()`, `log_team_login_change()`; nog NIET live
toegepast, zie "Bewijs P5 deel B"). P5 is daarmee klaar. Daarvoor P5 deel A (2026-10-07): klantbeheer `/admin/klanten` en
`/admin/klanten/$id`, "Klant toevoegen" en "Klant uitnodigen", uitnodigingen opnieuw
versturen/intrekken, deactiveren/activeren met login-ban, wachtwoord-resetlink, de publieke
pagina `/invite/$token` (paden a, b en c, ook staff-uitnodigingen) en migratie
`20261007150000_p5_customers.sql` met de twee carry-overs ("Order behouden" en staff-taken in
`handle_new_user`; nog NIET live toegepast, zie "Bewijs P5 deel A"). Daarvoor P4 reviewronde (2026-10-07): 26 reviewbevindingen nagelopen en opgelost,
met één nieuwe migratie `20261007120000_p4_order_guards.sql` (afgeven per klant, "Toch
afgeven" alleen op onbetaalde orders, nieuw bericht bij "Actie vereist", zending en
verzendwijze; nog NIET live toegepast, zie "Bewijs P4 reviewronde"). Daarvoor P4 deel B (2026-10-07): zendingen `/admin/zendingen` en
`/admin/zendingen/$id` (aanmaken, wijzigen, orders toevoegen/uit zending halen, "Status voor
hele zending wijzigen"), "Aan zending toevoegen" vanuit het orderoverzicht en de orderpagina,
statusbeheer `/admin/statussen` (beheerders wijzigen, staff lezen) en de navigatie voor alle
P4-pagina's (zie "Bewijs P4 deel B"). P4 is daarmee klaar. Daarvoor P4 deel A (zelfde dag): de
staff-kant van orders: `/admin/orders` (operationeel overzicht, ontvangen,
bulk-statuswijziging), `/admin/orders/nieuw` (order aanmaken voor klant), `/admin/orders/$id`
(alle staff-tools), tellingen en taken op `/admin`, server functions in
`lib/server-fns/admin-orders.functions.ts` en de middleware-fix (zie "Bewijs P4 deel A").
Daarvoor: P3 reviewronde
(2026-10-07): bevindingen van de P3-review verwerkt (zie "Bewijs P3 reviewronde"). Daarvoor P3 deel B (zelfde dag): order aanmelden
(`/portal/orders/nieuw` + `registerOrderFn`). P3 deel A (zelfde dag): klantdashboard, orderlijst en orderdetail.
Eerder: einde P2b (2026-10-06). P2a = databasefundament (3 migraties, commit
`7994a21`, live toegepast; types `e74d013`). P2b = auth, rolroutering, design tokens,
merk-assets, layouts, basis-homepage, i18n, eerste `docs/DEPLOYMENT.md`.

Bewijs P2b: `bun run test` 22 testbestanden, 310 tests groen (1 skipped);
`bunx tsc --noEmit` schoon; `bun run build` en `VERCEL=1 bun run build` slagen
(`.vercel/output` aanwezig). Browsercontroles met Playwright tegen de dev-server, met
Supabase Auth/REST gestubd (geen live auth-aanroepen): 320/360/390/768/1024/1440 px,
axe 0 overtredingen op alle publieke en auth-pagina's.

| § | Onderwerp | Status | Bewijs |
|---|---|---|---|
| 1 | Bestaand project inspecteren | n.v.t. | vervangen door "Known facts" in §35.1 |
| 2 | Branding & design | klaar (P2b) | tokens in `src/styles.css` (oklch, §35.14); `BrandLogo` banner/monogram/lockup; favicon, apple-touch-icon, icon-512 uit het logo; Montserrat/Inter via @fontsource |
| 3 | Bedrijfsdoel | deels (P2b) | homepage-teksten in `nl.ts`; rest volgt met de functies (P3+) |
| 4 | Klantaccount & GR-code | klaar voor staff (P5-A) | DB + GR-nummering (P2a, `m1_identity.test.ts`); portal toont naam + GR-code (P2b); P5-A: klanten met en zonder login, "Klant toevoegen" (naam + telefoon verplicht, bestaande GR-code optioneel met live controle "GR00042 is al toegewezen aan Maria Pinas"), code wijzigen (beheerder, reden, alleen zonder orders/uitgegeven facturen, `change_customer_code`), deactiveren/activeren (beheerder, reden, login-ban); `customers_contract.test.ts` |
| 5 | Uitnodigingen / bestaande klanten | klaar (P5-A, e-mail P8) | "Klant uitnodigen" (nieuw of bestaand dossier, nooit een tweede dossier voor een adres: conflicten "heeft al een login", "al uitgenodigd", "gedeactiveerd", "andere code", "geen e-mail" met de weg vooruit), link alleen één keer op het scherm (kopiëren, WhatsApp), "Opnieuw versturen" (nieuw token, 1×/minuut, 5×/Surinaamse dag) en "Intrekken"; `/invite/$token`: geldig/verlopen/ingetrokken/gebruikt/ongeldig, pad a (nieuwe login), b (onbevestigde registratie), c (bestaande login: eerst inloggen), staff-uitnodiging (naam → profiel, daarna `/admin`); tests `server/invitations.test.ts`, `customers_contract.test.ts`; P5-review: limieten 1×/minuut en 5×/dag per e-mailadres (ook intrekken + opnieuw uitnodigen), linkdialogen vragen vóór sluiten zolang de link niet gekopieerd/gedeeld is, volledig e-mailadres in de WhatsApp-tekst en na activeren, conflict laat het formulier staan; P8: e-mail "uitnodiging" (klant en staff, sleutel `invite:<id>:<send_count>:<Surinaamse dag>`) en "welkom" na inwisselen (met het persoonlijke US-adres) via `sendEmail`; de linkdialoog meldt de echte uitkomst en de link blijft altijd kopieerbaar/deelbaar |
| 6 | Authenticatie | klaar (P2b), live niet geverifieerd | `/login`, `/registreren`, `/wachtwoord-vergeten`, `/auth/confirm`, `/auth/set-password`, uitloggen; guards `/portal` (klant) en `/admin` (staff/admin); tests `auth-errors`, `callback`, `guards`, `redirect`, `roles`, `schemas`; e-mailtemplates in `supabase/templates/` (`auth-templates.test.ts`) |
| 7 | Homepage | basis (P2b) | `/` met hero, "Hoe het werkt", diensten, contact uit `public_company_info()`; definitieve versie P10 |
| 8 | Klantdashboard | klaar (P3-A) | `/portal`: GR-code (kopiëren), eerste kaart "Uw persoonlijk US-verzendadres" (`warehouse_addresses`, `{FULL_NAME}`/`{GR_CODE}` ingevuld, kopieerknop per veld + "Kopieer volledig adres", leeg: "Ons US-adres wordt binnenkort hier getoond."), KPI's Orders ("Waarvan N nog niet ontvangen" linkt naar `?stage=registered`, "Alle orders bekijken") / Openstaande facturen (`invoice_overview` open+deels betaald, saldo per valuta, achterstallig, links naar de orders met een open factuur, achterstallige eerst) / Zendingen onderweg / Klaar voor afhalen (op `stage`; afhaaladres, -tijden en "Meenemen" elk los getoond; "Betaal eerst de openstaande factuur voordat u ophaalt" bij een klaarliggende order met open factuur, volgens `pay_before_pickup`), laatste order (met omschrijving), recente activiteit (orders + `shipment_status_history` + uitgegeven én geannuleerde facturen (op `cancelled_at`) + betalingen), CTA "Order aanmelden"; elke query filtert ook zelf op `customer_id` (RLS laat staff alles zien); tests `orders`, `invoices`, `warehouse`, `activity`, `scoping` |
| 9 | Order aanmelden | klaar (P3-B) | `/portal/orders/nieuw`: stap 1 "Persoonlijke order" / "Zakelijke order (B2B)" met uitleg (`?type=` in de URL, terugknop werkt, ingevulde velden blijven staan); formulier: verzendwijze (alleen `service_rates.enabled`, standaard lucht), winkel, ordernummer, omschrijving, aantal, geschatte waarde + valuta (USD/EUR/SRD), aankoopdatum, verwachte leverdatum (optioneel; onder elk datumveld "Gekozen datum: dd-mm-jjjj", omdat de browser het veld in zijn eigen notatie toont), trackingnummer "Optioneel / indien bekend", vervoerder (lijst UPS/FedEx/USPS/DHL/Amazon Logistics/OnTrac + "Anders" + "Nog niet bekend"), gewicht lbs (optioneel), opmerking; B2B: leverancier, PO-nummer, inkoopwijze met uitleg (vóór "Aankoop"; bij "Inkoop door G&R" zijn winkel, waarde en aankoopdatum optioneel, mag de leverancier de winkel vervangen en mag de geplande aankoopdatum tot 1 jaar vooruit; dezelfde regels bij wijzigen); documenten (optioneel, soort per bestand, type/grootte vooraf gecontroleerd, max. 10); verplicht vinkje "Mijn zending bevat geen verboden goederen" met link naar `/verboden-goederen`. `registerOrderFn` (`lib/server-fns/orders.functions.ts`): `requireSupabaseAuth` + zod (zelfde schema als het formulier), klant via `rpc('current_customer_id')` (een staff-login met klantdossier wordt geweigerd, 42501), insert met de client van de gebruiker (RLS + `orders_before_insert`), geeft id + referentie; P8-haak `onOrderRegistered` in `src/server/order-notifications.ts`. Daarna uploadt de browser de documenten één voor één met status per bestand; mislukt er een, dan blijft de order bestaan, met melding, "Opnieuw proberen" en "Naar de order". Toast "Order succesvol aangemeld." en door naar de orderpagina. Bij een mislukte aanmelding gaat de focus naar de foutmelding, bij het uploadscherm naar de kop. `?parent=<id>`: extra pakket (soort order, winkel en ordernummer van de hoofdorder; `registerOrderFn` neemt ze over van de hoofdorder, maar de database controleert het niet: een directe API-insert kan afwijken, zie "Carry-over fixes"; link naar een extra pakket wordt gevolgd naar de hoofdorder; geannuleerde hoofdorder geweigerd). Tests: `order-schema`, `register-order`, `document-queue`, `order-fields`, `order-notifications`, `app-routing` |
| 10 | Orderdetail | klaar (P3-A) | `/portal/orders` (zoeken op referentie/winkel/omschrijving/ordernummer/tracking, filter status-fase + "Onderweg en in behandeling", soort (Zakelijk-badge), sorteren op datum; omschrijving in tabel en kaarten; tabel vanaf 1280 px (referentie en datum op één regel, trackingkolom breed genoeg), daaronder kaarten (twee kolommen vanaf 768 px, label boven waarde); filters in de URL) en `/portal/orders/$id`: alle §10-velden, statusbadge, voortgang per fase + statusgeschiedenis (alleen customer_visible via RLS, wijzigingen als "G&R Solutions", klantbericht), voortgang buiten het normale pad: "Actie vereist" als huidige stap met de rest nog te gaan, geannuleerd eindigt met "Geannuleerd"; banner "Actie vereist" met upload, afhaalgegevens bij "Klaar voor afhalen" plus "Betaal eerst de openstaande factuur …" met openstaand bedrag per valuta en link naar de facturen, facturen via `invoice_items` → `invoice_overview` met badges en betaalinstructie, documenten (upload naar `order-documents` op `{customer_id}/{order_id}/{uuid}.{ext}`, type/grootte vooraf gecontroleerd, upload met `cacheControl: "0"`, download via `createSignedUrl(path, 300)` onder een veilige naam: ASCII-deel van de oorspronkelijke naam + de door de database gecontroleerde extensie van `storage_path`, `documentDownloadName()`), wijzigen zolang fase `registered` (soort order, winkel en ordernummer alleen-lezen bij een extra pakket en bij een hoofdorder met pakketten), "Annulering aanvragen" (`request_order_cancellation`, bevestigingsdialoog), gekoppelde pakketten + "Extra pakket toevoegen"; tests `orders`, `documents`, `order-fields`, `scoping`, `nav`, `app-routing`, PGlite `portal_contract` |
| 11 | Statusbeheer | klaar (P4, e-mail P8) | P4-B: `/admin/statussen` toont alle statussen per fase (in reisvolgorde, ook lege fasen) met naam, code, omschrijving voor de klant, zichtbaar voor klant, klant e-mailen, volgorde, actief/inactief, "Standaard" (eerste actieve status van de fase: daar starten nieuwe orders, daarheen gaat ontvangen en afgeven) en het aantal orders dat nu op elke status staat; staff lezen (melding "Alleen een beheerder …", geen knoppen), beheerders voegen toe (fase + code, beide daarna vast; code wordt uit de naam voorgesteld, uniek, `^[a-z][a-z0-9_]{1,49}$`; volgorde voorgesteld achter de fase), wijzigen naam/omschrijving/volgorde/zichtbaar/e-mailen (onzichtbare status mailt nooit) en deactiveren/activeren (nooit verwijderen; orders en historie houden de status; waarschuwing bij de laatste actieve status van een fase, de laatste "Aangemeld" wordt geweigerd zoals de database doet, 55000); alles met de eigen client (RLS `is_admin`), fouten inline + toast. Statuswijziging enkel en in bulk via één `change_order_status`-aanroep (`changeOrderStatusFn`, staff-client, nooit service role): dialoog met alleen actieve statussen per fase, "Bezorgd" alleen bij `delivery_available`, huidige status uitgeschakeld, bericht voor de klant ("Zichtbaar voor klant"; verplicht bij "Actie vereist"), "Klant e-mailen" (start op `notify_customer`, uit bij niet-zichtbare status; P8-haak `onOrderStatusChanged`, max. één e-mail per klant per actie via `planStatusEmails`), afhalen met naam ophaler + `pay_before_pickup`-blokkade (vooraf gecontroleerd én op de `pay_before_pickup`-hint van de database) en "Toch afgeven" met verplichte reden (`pickupFn` → `pickup_override`, reden in `audit_log`), B2B-waarschuwing (niet blokkerend) zonder commerciële factuur/paklijst richting douane, "Documenten opvragen" = "Actie vereist" voorgeselecteerd; volledige historie met namen ("door Maria", profiles), van → naar, tijd, bericht en "Niet zichtbaar voor klant". Tests: `admin/order-actions`, `admin/statuses`, `admin/orders`, `admin/status-config`, PGlite `admin_contract` en `shipments_contract`; P4-review: afgeven per klant (dialoog + database), "Toch afgeven" audit alleen op onbetaalde orders, nieuw bericht bij "Actie vereist" (eigen historieregel), niet-ontvangen orders blijven staan voorbij het US-magazijn, volgende status voorgeselecteerd, melding "E-mail is nog niet geconfigureerd" (migratie `20261007120000_p4_order_guards.sql`); P8: "statusupdate" één e-mail per klant per actie (`onOrderStatusChanged`, sleutel `order:<eerste order>:status:<laagste history-id>`, de gewijzigde orders + klantbericht), toast/omschrijving zegt verstuurd, overgeslagen (e-mail niet ingesteld), mislukt of geen e-mailadres |
| 12 | Admin-dashboard | klaar (P5-B) | `/admin`: "Nog in te stellen" (bankgegevens ontbreken per valuta, geen actief US-adres, geen verzendwijze aan, geen tarief per lb, afhaaltijden leeg, voorwaarden/verboden goederen nog voorbeeldtekst; voor beheerders ook servicesleutel, APP_URL en e-mail), elk met "Naar instellingen" naar de juiste sectie (scrolt en focust); "Overzicht": klanten totaal + nieuw in 30 dagen + actief/uitgenodigd/gedeactiveerd, nieuwe orders (30 dagen) + lopende orders, openstaande facturen (aantal + openstaand bedrag PER VALUTA, link naar klanten met openstaande facturen), achterstallig (aantal + bedrag per valuta, uit `invoice_overview.is_overdue`), betaalde facturen (+ laatste 30 dagen, concepten); ordertellingen per fase (P4); open taken met "Order openen" en nu ook "Klant openen" (`customer_id`); "Recente activiteit" (statuswijzigingen met "door …", nieuwe klanten, geaccepteerde uitnodigingen, uitgegeven/geannuleerde facturen, betalingen; links naar order en klant); "Systeemstatus" (beheerders, `systemStatusFn`: alleen booleans voor servicesleutel, APP_URL (of Vercel-adres), e-mailprovider, CRON_SECRET, plus de laatste herinneringsronde uit `job_runs`). Tests `admin/dashboard` (`summarizeInvoiceStats`, `mergeStaffActivity`, `daysAgo`), `admin/system-status` (`setupChecklist`), `server/system-status` (alleen booleans, nooit een waarde); P5-review: "Open taken" bovenaan, medewerkers zien de setup-lijst als één regel, laadfout in de setup-lijst zichtbaar met "Opnieuw proberen" |
| 13 | Klantbeheer | klaar (P5-A, P5-B) | `/admin/klanten`: zoeken op naam, bedrijf, GR-code ("gr 17", "17"), e-mail, telefoon (met/zonder +597), filters status, soort, login ja/nee, "Openstaande facturen", sorteren (GR-code, naam, nieuwste, oudste), alles in de URL; tabel Klant \| Contact \| Status \| Login \| Orders \| Openstaand \| Klant sinds vanaf 1280 px, kaarten daaronder. `/admin/klanten/$id`: contactgegevens (wijzigen; e-mail alleen beheerder, met waarschuwing bij login/open uitnodiging), account en login, uitnodigingsstatus met acties, orders (links), zendingen, facturen + betalingen (alleen-lezen, per valuta), documenten (download), interne notities, Nederlandse geschiedenis (beheerder: uit `audit_log`; staff: uit de rijen), "Order aanmaken voor deze klant" (`/admin/orders/nieuw?customer=`), wachtwoord-resetlink; P5-B: teampagina `/admin/team` en instellingen `/admin/instellingen` (zie §35 hieronder) |
| 14 | Factuur genereren | klaar (P6-A) | `/admin/facturen/nieuw`: klant kiezen (GR-code/naam), orders van die klant (standaard zonder vracht op een niet-geannuleerde factuur; schakelaar toont de rest), per order één vrachtregel ('{winkel} – order {nummer}', tracking/ref-regel, gemeten gewicht na afronding en minimum van `service_rates`, anders het opgegeven gewicht met waarschuwing, tarief uit `service_rates` in de factuurvaluta), regels toevoegen/verwijderen/verplaatsen (inklaring, handling, goederen, servicekosten, overige met omschrijving, korting), valuta (één per factuur), factuurdatum (vandaag in Suriname) en vervaldatum (+ `payment_term_days`, volgt de factuurdatum tot hij zelf gewijzigd wordt), OPMERKINGEN; validatie volgens de CHECKs en `issue_invoice` vóór het verzenden (alle fouten tegelijk, focus op de eerste, "Datums bijwerken"); waarschuwingen bankgegevens en tarief; "Genereer factuur" vanaf `/admin/orders` (selectie van één klant), `/admin/orders/$id` en `/admin/klanten/$id` (`?customer=&orders=&from=`); tests `admin/invoice-builder`, PGlite `invoice_builder_contract` |
| 15 | Live factuurvoorbeeld | klaar (P6-A, review) | links formulier, rechts het echte `InvoiceDocument` op ware grootte geschaald met `transform: scale()` (≥ 1024 px), daaronder tabs "Gegevens" \| "Voorbeeld"; het voorbeeld rekent met `computeInvoiceTotals` en de live instellingen; review: "Vergroten" toont het op ware grootte, onder 1024 px staan totaal, "Genereer factuur" en "Opslaan als concept" ook onder het voorbeeld; zie "Bewijs P6/P7 deel A" en "reviewronde" |
| 16 | Factuur genereren & opslaan | klaar (P6-A, P7-B) | "Opslaan als concept" (eigen client, RLS; regels worden bijgewerkt, niet vervangen) en "Genereer factuur" (opslaan, dan `issueInvoiceFn` → `issue_invoice`: nummer, totalen, snapshots; P8-haak `onInvoiceIssued`; sinds P8 de e-mail "factuur aangemaakt" met de echte uitkomst in de UI); `/admin/facturen/$id`: concept → bouwer (ook "Concept verwijderen"), uitgegeven → document uit de snapshots met alle acties (P7-B); P7-B: `/admin/facturen` (alle facturen, ook concepten; zoeken op nummer "2026-0012"/"0012", GR-code "gr 42", naam/bedrijf zonder accenten, orderreferentie; filters status (Nog te betalen, Openstaand, Deels betaald, Achterstallig, Betaald, Concept, Geannuleerd; "Achterstallig" uit `invoice_overview.is_overdue`), valuta, periode (deze/vorige maand, 30 dagen, dit/vorig jaar, zelf kiezen); sorteren nieuwste/oudste/vervaldatum/bedrag/klant; alles in de URL; totalen van de selectie per valuta: gefactureerd, betaald, openstaand, achterstallig; tabel vanaf 1280 px, kaarten daaronder); tests `admin/invoices`, PGlite `invoices_contract`; P9: kaart "Geschiedenis" op `/admin/facturen/$id` (concept aangemaakt, uitgegeven, betalingen geregistreerd/ongedaan gemaakt, opslag, betaald, geannuleerd; met wie en wanneer); "Exporteer CSV" (beheerders) op `/admin/facturen`: facturen met regels en de betalingen van de getoonde facturen |
| 17 | Factuurstatus | klaar (P7-B) | status alleen via de database: betalingen leiden de status af (`record_payment` → 'Deels betaald'/'Betaald' met `paid_at`), "Betaling ongedaan maken" (`void_payment`, beheerder, reden), "Factuur annuleren" (`cancel_invoice`, beheerder, reden zichtbaar voor de klant, geweigerd zolang er betalingen op staan), "Corrigeren" (annuleren, dan een nieuw concept met `replaces_invoice_id`, dezelfde klant, orders en valuta), "Opslag 15% toepassen" (`apply_late_fee`, beheerder, alleen achterstallig, één keer; het bedrag staat vóór het bevestigen in de dialoog, berekend als de database: `lateFeeAmount`); "Achterstallig" nooit opgeslagen (overal `invoice_overview`); badges tekst + icoon (Openstaand, Deels betaald, Betaald, Achterstallig, Geannuleerd, Concept); stempel "BETAALD dd-mm-jjjj" en watermerk "GEANNULEERD" op het document; tests `admin/invoice-actions`, `InvoiceDialogs.test.tsx`, PGlite `invoices_contract` |
| 18 | Klantfacturen | klaar (P7-B) | `/portal/facturen`: alleen uitgegeven facturen van de klant (RLS + eigen filters), nummer, datum, vervaldatum, orders (uit `bill_to_snapshot`, links naar de orders), bedrag, nog te betalen, badge, "N dagen te laat"/"Betaald op"; bovenaan "Nog te betalen" per valuta + aantal achterstallig; filter Alle / Nog te betalen / Betaald (`?show=`); `/portal/facturen/$id`: het document uit de snapshots, "Zo betaalt u deze factuur" (te betalen, uiterlijk, al betaald, achterstallig, betaalreferentie `{nummer} / {code}` met kopieerknop, rekening van de factuurvaluta uit de snapshot met kopieerknop, of "neem contact op" als die ontbreekt), ontvangen betalingen (niet de ongedaan gemaakte), "Opslaan als PDF"; concept of factuur van een ander → "Factuur niet gevonden"; links vanaf het dashboard (KPI "Facturen bekijken en betalen", recente activiteit) en de orderpagina; nav "Facturen" |
| 19 | Betalingsherinneringen | klaar in code (P8), live niet geverifieerd | `src/server/reminders.ts` `runPaymentReminders({ trigger })`: vensters van §35.12 op de Surinaamse datum (vóór vervaldatum, eerste na vervaldatum, herhaling na het interval tot het maximum), de herinneringskolommen tellen alleen herinneringen na de vervaldatum en worden pas na een geslaagde verzending geboekt, een `job_runs`-regel per ronde, 45 s budget ("uitgesteld" voor de rest); cron-route `src/routes/api/cron/payment-reminders.ts` (GET/POST, `Authorization: Bearer CRON_SECRET` als sha256 + `timingSafeEqual`, 401 bij verkeerd, 500 zonder secret, geen parameters uit het verzoek); pg_cron-job `gr-payment-reminders` om 12:00 UTC via `private.invoke_payment_reminders()` (Vault `app_url` + `cron_secret`, doet niets zonder; migratie `20261008090000_p8_reminders.sql`); `/admin/herinneringen`: "Herinneringen nu versturen", per factuur "Herinnering nu versturen" (1× per Surinaamse dag), laatste rondes, geschiedenis per factuur uit `email_logs`, klanten zonder e-mail met "Herinner via WhatsApp"; tests `server/email.test`, `server/cron-payment-reminders.test`, `lib/email/reminders.test`, `lib/admin/reminders.test`, PGlite `p8_reminders`, `email_contract`. P7-B toont op `/admin/facturen/$id` de administratie alleen-lezen (aantal, eerste en laatste herinnering) en "N× herinnerd" in de lijst |
| 20 | Klanthistorie | klaar (P9) | `/portal/historie` (nav "Historie"): per jaar uit de RPC `customer_history_by_year` ("2026: 8 orders, 1 zending, 2 facturen, 1 betaling"; klik = alleen dat jaar), daaronder alle orders, zendingen (met de eigen orders erin als links), uitgegeven facturen (badge, totaal, nog te betalen), betalingen (niet ongedaan gemaakt) en statuswijzigingen (alleen customer_visible via RLS, met klantbericht), per jaar gegroepeerd, nieuwste eerst; filters jaar en soort (Orders/Zendingen/Facturen/Betalingen/Statuswijzigingen) en zoeken (referentie, factuurnummer, zending, winkel, omschrijving, tracking ook zonder streepjes, statusnaam, bericht; accentongevoelig) in de URL; elke regel opent zijn order- of factuurpagina; jaartelling als de RPC (orders op aanmelding, zendingen op vertrek anders aanmaak, facturen op factuurdatum, betalingen op betaaldatum, Surinaamse tijd); alle queries filteren ook zelf op de klant (status en betalingen via de eigen order- en factuur-id's); tests `portal/history.test`, PGlite `history_export_contract` (records == RPC-tellingen, Bob ziet niets van Alice, RPC voor een ander id 42501) |
| 21 | Admin order-/zendingbeheer | klaar (P4, klantpagina P5-A, facturen P6/P7; P7-B: kolom "Factuur" linkt naar de factuur) | P4-B zendingen: `/admin/zendingen` (zoeken op zendingnummer, vervoerder of AWB/container ook zonder streepjes, filter verzendwijze en "Alleen lopende zendingen", in de URL; tabel Zending \| Verzendwijze \| Vervoerder \| Vertrokken \| Aangekomen \| Orders (aantal, klanten, gemeten lbs) \| Status van de orders (aantal per fase, "Zending afgerond") vanaf 1280 px, past op 1280 zonder scrollen, kaarten daaronder; "Zending aanmaken" → de nieuwe zendingpagina). `/admin/zendingen/$id`: gegevens (alles zichtbaar voor klanten met een order erin, ook het bericht), inhoud (orders, klanten, gemeten gewicht, nog niet gewogen, per fase), waarschuwingen (order nog niet ontvangen, andere verzendwijze), orders met rij-acties (status, ontvangen, afgeven, "Uit zending halen") en selectie (status wijzigen, uit zending halen); "Orders toevoegen": alleen orders met dezelfde verzendwijze die niet afgehaald/bezorgd/geannuleerd zijn, ontvangen eerst, scannen + Enter vinkt de order met dat trackingnummer aan (anders zegt de melding waarom niet: andere verzendwijze, al afgerond, al in deze zending, onbekend, meerdere), een order uit een andere zending verhuist (badge "Nu in zending …"); één `PATCH orders` met `service_type=eq.<zending>` in het filter zelf; "Status voor hele zending wijzigen" = één `change_order_status` (via `changeOrderStatusFn`, P8-haak, max. één e-mail per klant) met alle lopende orders, afgeronde orders blijven staan; "Gegevens wijzigen" (verzendwijze vast zolang er orders in zitten); zendingnummer uniek ongeacht hoofdletters (eigen melding). "Aan zending toevoegen" ook vanuit een selectie op `/admin/orders` en op de orderpagina (vooraf: hoeveel orders meegaan en welke worden overgeslagen); de orderpagina toont de zending met "Uit zending halen" en een link. P4-A `/admin/orders`: groot zoek-/scanveld (tracking genormaliseerd, GR-code "gr 17", referentie, klantnaam/bedrijf zonder accenten, winkel, ordernummer, omschrijving), filters status-fase, soort (Zakelijk), "Wacht op ontvangst", "Openstaande factuur", "Annulering aangevraagd", sorteren (nieuwste, oudste, klant, status); tabel Order \| Klant \| Type \| Tracking \| Status \| Factuur \| Betaling vanaf 1280 px (past op 1280 zonder scrollen), kaarten daaronder; factuur/betaling alleen-lezen uit `invoice_items` → `invoice_overview` (concepten zichtbaar, per valuta); rij-acties openen, status wijzigen, ontvangen/gewicht corrigeren, afgeven; selectie → één bulk-statuswijziging; klantnaam zonder link (P5-A: klantnamen op `/admin/orders`, `/admin/orders/$id` en `/admin/zendingen/$id` linken naar `/admin/klanten/$id`). Ontvangen zonder scanner (§35.7): exacte trackingmatch → "Ontvangen in US-magazijn" direct vanuit het zoekresultaat (`receiveOrderFn` → `receive_order`, gewicht ≤ 2 decimalen, Nederlandse komma), dubbel trackingnummer → waarschuwing + badge "Dubbel", geen match → "Order aanmaken voor klant" met het nummer. `/admin/orders/nieuw` (`createOrderForCustomerFn`): elke klant ook zonder login (gedeactiveerde niet kiesbaar), dezelfde velden als het portaal, optioneel direct ontvangen met gemeten gewicht, extra pakket via `?parent=`. `/admin/orders/$id`: klant, alle ordervelden, ontvangen/afgegeven door wie, zending (link naar `/admin/zendingen/$id`), facturen (ook concepten), documenten (upload in elke fase, download onder veilige naam, verwijderen), pakketten van de aankoop + "Extra pakket aanmaken", interne notities, voortgang en historie, banners voor annuleringsverzoek (annuleren of behouden), actie vereist, klaar voor afhalen (openstaand per valuta), ontbrekende douanedocumenten; P4-review: scanlus zonder klikken (veld leeg + focus na ontvangen), zoekresultaat direct onder het zoekveld met status en volgende stap, selectiebalk blijft in beeld, "Onbekend" als facturen niet laden, gewicht invullen na het magazijn, verzendwijze van een order in een zending vast (database) |
| 22 | Databaseontwerp | klaar (P2a) | `supabase/migrations/*.sql` (3 bestanden), `m1/m2/m3_*.test.ts` in PGlite |
| 23 | Row Level Security | klaar in DB (P2a) | RLS + grants per tabel, PGlite-tests; live RLS-tests P10 |
| 24 | E-mailsysteem | klaar in code (P8), live niet geverifieerd | auth-templates (P2b); P8: `sendEmail` (Resend REST, `Idempotency-Key`, From `EMAIL_FROM`, Reply-To `EMAIL_REPLY_TO` of `company_settings.email`, claim in `email_logs` met on conflict do nothing, 'failed'/'skipped_no_provider' opnieuw te claimen, 429 één keer opnieuw), sjablonen in `src/server/email-templates/*` (logoband van APP_URL, alle klanttekst ge-escaped, links alleen via `getAppUrl()`, klanten zonder login krijgen geen /portal-links maar de details en zo mogelijk de uitnodiging), haken uitgevoerd in `src/server/{order,invoice,invitation}-notifications.ts`; DEPLOYMENT §6 (Resend, Vercel-variabelen, custom SMTP) en §7 (Vault, CRON_SECRET, testen) |
| 25 | Responsive design | basis (P2b, P3-A, P3-B, P4) | publieke, auth-, portal- en admin-layouts gecontroleerd op 320–1440 px zonder horizontale scroll; P3-A: dashboard, orderlijst (tabel → kaarten) en orderdetail (facturentabel → kaarten via container query) op 320/390/768/1024/1440 px; P3-B: aanmeldformulier op dezelfde breedtes, velden 44 px hoog op telefoons, `inputmode` numeric/decimal, datumvelden; reviewronde: dialoogvensters krimpen met lange bestandsnamen mee (`grid-cols-[minmax(0,1fr)]`), orderlijst tabel pas vanaf 1280 px; eindronde P10; P4-A: admin-layout breder (`AppShell wide`), orderoverzicht tabel vanaf 1280 px (past op 1280 en 1440 zonder horizontaal scrollen, tabelkaart is `relative overflow-x-auto` als vangnet), kaarten met selectievakje daaronder, dialogen binnen 320–1440 px; P4-B: zendingenlijst, zendingpagina (orders als tabel vanaf 1280 px, kaarten daaronder) en statussen (tabel per fase vanaf 1280 px met de omschrijving onder de naam, kaarten daaronder) passen op 1280 px; dialogen (zending, orders toevoegen, aan zending toevoegen, status toevoegen/wijzigen/deactiveren) binnen 320–1440 px, knoppen op telefoons volle breedte; eindronde P10; P5-B: dashboard (KPI-kaarten 1/2/3/5 kolommen), team (tabel vanaf 1280 px, kaarten daaronder) en instellingen (secties, bankrekeningen 3 kolommen vanaf 1024 px, dialoog US-adres) op 320–1440 px zonder horizontale scroll; P7-B: factuurlijst (tabel vanaf 1280 px), factuurpagina, dialogen (betaling, WhatsApp, opslag, corrigeren), klantfacturen (tabel vanaf 1280 px) en klantfactuur, print-routes op 320/390/768/1024/1280/1440 px zonder horizontale scroll (document geschaald, nooit opnieuw opgemaakt); P9: `/portal/historie` (jaarkaarten 1/2/3 kolommen, regels als lijst), `/admin/audit` (tabel vanaf 1280 px, kaarten daaronder, lade volle breedte op telefoons) en de exportknoppen/-menu op klanten, orders en facturen op 320/390/768/1024/1440 px zonder horizontale scroll |
| 26 | UX-eisen | deels (P2b, P3-A, P3-B, P4) | alle fouten bij eerste verzending zichtbaar, inline loginfouten, laad-/fout-/leegstaten, toasts; P3-A: elke kaart/sectie heeft eigen laad-, fout- (met "Opnieuw proberen") en leegstaat; P3-B: order aanmelden in twee stappen, alle veldfouten bij de eerste verzending (ook de regels over meerdere velden: validatie in twee lagen, `refineOrderFields`), focus op het eerste foute veld; P4-A: staff vinden een order met één zoekveld (Enter = direct zoeken, voor scanners), ontvangen vanuit het zoekresultaat, bulk-statuswijziging, statusdialoog toont alle fouten tegelijk en focust het eerste veld; P4-B: een hele zending in één keer van status wisselen, orders in een zending scannen, zending- en statusformulieren tonen alle fouten tegelijk met focus op het eerste veld; P5-A: klantdialogen tonen alle veldfouten bij de eerste verzending met focus op het eerste foute veld, live GR-code-controle, conflicten als uitleg met een knop naar de juiste klant, "Opnieuw versturen kan over N seconden" / daglimiet uitgelegd, `/invite` met één duidelijke stap per toestand; P5-B: instellingen per sectie opslaan (alleen gewijzigde kolommen, "Er was niets gewijzigd"), alle veldfouten tegelijk met focus op het eerste veld (ook regels over meerdere velden, zoals BTW-uitsplitsing zonder tarief), live waarschuwing als de betalingsvoorwaarden een andere termijn of opslag noemen dan ingesteld, live voorbeeld factuurnummer, live voorbeeld van het persoonlijke US-adres van een gekozen klant, live rekenvoorbeeld van het tarief; medewerkers zien de instellingen en het team alleen-lezen ("Nog niet ingesteld" bij lege waarden); P7-B: betaling registreren met alle fouten tegelijk (bedrag boven saldo, datum in de toekomst, ontvangen bedrag zonder valuta) en focus op het eerste veld, bedrag vooraf ingevuld met het saldo, opslag eerst als bedrag getoond, klant ziet in één blok of en hoe hij moet betalen (§26 punt 6); P9: historie per jaar met één klik op een jaar, filters en zoeken in de URL, lege staat met "Order aanmelden"; auditlog filteren op tabel, wie, periode en record-id, vanuit de lade "Alleen wijzigingen door …" en "Alle wijzigingen van dit record", vorige/volgende pagina; "Exporteer CSV" exporteert wat de filters tonen (aantal staat in het label) en meldt de bestandsnaam en het aantal regels |
| 27 | Beveiliging | deels (P2b) | geen geheimen in code (`server-boundary.test.ts`), `frame-ancestors`/nosniff/referrer-policy (`security-headers.test.ts`), adres-enumeratie verborgen op reset/resend; P5-A: service role alleen in `src/server/*` (dynamische import in server-function handlers) voor `auth.admin.*` en voor het opzoeken/inwisselen van een uitnodiging nadat het token is gecontroleerd en gehasht; uitnodigen zelf met de eigen sessie van staff (RLS); alleen de SHA-256 van het token in de database, het ruwe token één keer in de link; resetlinks voor logins die ook staff/beheerder zijn alleen door een beheerder; P5-B: een gedeactiveerde (gebande) login heeft in de database geen rol meer (`has_role`/`is_staff` negeren `auth.users.banned_until` in de toekomst), dus een nog geldig toegangstoken verliest direct alle rechten en uitnodigingen van die persoon werken niet meer; `set_user_role` houdt altijd een beheerder die kan inloggen; teamacties alleen voor beheerders (UI, server function én database); Systeemstatus geeft nooit een waarde of lengte van een geheim terug; P5-review: een login die bij het team hoort wordt nooit vanaf een klantpagina gebannen/ontbannen of gereset (ook niet de eigen), een uitnodiging van een gedeactiveerde uitnodiger telt als ingetrokken vóórdat Auth wordt aangeraakt, profielnaam en `user_metadata` komen uit de uitnodiging (niet van een vreemde die het adres vooraf registreerde), deactiveren van een teamlid trekt al diens uitnodigingen in met notitie per klant; P8: service role alleen voor de `email_logs`-administratie en voor de herinneringsronde na de CRON_SECRET-controle (§35.2); pg_net blijft zoals Supabase het installeert (eigenaar `supabase_admin`, uitvoerbaar voor PUBLIC; een migratie kan dat niet intrekken), de afscherming is dat `net` geen blootgesteld API-schema is en geen functie die een API-rol mag aanroepen pg_net gebruikt (getest; DEPLOYMENT §7.4: controleer "Exposed schemas"); P9: auditlog alleen voor beheerders (RLS `is_admin`, nav-item en pagina alleen voor beheerders), CSV-export in de browser met de eigen client (RLS bepaalt de inhoud, niets via een server function, niets opgeslagen), tekst die Excel als formule zou lezen (= + - @) krijgt een apostrof (CSV-injectie) |
| 28 | Audit trail | klaar (P4, P5, P9) | audit-triggers in DB (P2a); P4-A: statuswijzigingen leesbaar op de orderpagina met wie/wanneer ("door Maria", `shipment_status_history.changed_by` → profiles), ontvangen door, afgegeven door, reden van "Toch afgeven" in `audit_log.reason`; P4-B: aanmaken/wijzigen van zendingen, verhuizen van orders tussen zendingen en elke statusconfiguratie-wijziging staan in `audit_log` via de bestaande triggers (bewezen in `shipments_contract`); generieke auditweergave: zie P9 hieronder; P5-A: klantpagina "Geschiedenis" in het Nederlands uit `audit_log` (beheerder): aangemaakt met code, code gewijzigd (oud → nieuw + reden), gegevens gewijzigd (welke velden), uitgenodigd, opnieuw verstuurd, ingetrokken, login gekoppeld, gedeactiveerd/geactiveerd (reden), met wie en wanneer; staff zien dezelfde gebeurtenissen afgeleid uit de rijen; deactiveren/activeren en resetlinks laten ook een interne notitie achter; P5-B: elke instellingswijziging in `audit_log` via de bestaande triggers (alleen gewijzigde kolommen; bewezen in `team_settings_contract`), factuurteller en volgende klantcode via hun RPC's (eigen auditregel), rolwijzigingen (`user_roles`-trigger), deactiveren/activeren van een teamlid als auditregel `team_login` met reden (`log_team_login_change`); P9: `/admin/audit` (beheerders): tabel tijd, wie, tabel, actie, record (herkenbaar: GR-code + naam, ordernummer, factuurnummer, bedrag …), gewijzigde velden; filters in de database (tabel, wie, Surinaamse datum van/tot en met, record-id), 50 per pagina, lade met per veld oud ↔ nieuw (gewijzigd eerst, "Ook ongewijzigde velden tonen"), de volledige JSON en een link naar de pagina van het record; leesbare tijdlijnen (§35.13): orderstatus (P4), klant (P5-A) en nu de factuur (`InvoiceTimeline`); tests `admin/audit.test`, `admin/invoice-timeline.test`, PGlite `history_export_contract` (filters, staff ziet niets) |
| 29 | Foutafhandeling | deels (P2b, P3-A, P3-B) | `src/lib/errors.ts` (Postgres/PostgREST → Nederlands), `auth-errors.ts`, 404- en foutpagina, Nederlandse toasts; P3-A: opslaan/annuleren/upload met succes- en fouttoast, uploadfouten (type/grootte/leeg/geweigerd) inline in het dialoogvenster; P3-B: aanmeldfouten als toast én blijvende melding boven de knop (o.a. 54000 `open_order_limit` met de Nederlandse databasetekst); server functions geven fouten terug als data (`TransportError` in `errors.ts`), omdat TanStack Start bij een gegooide fout alleen de `message` meestuurt; P4-A: `requireStaff`/`requireAdmin` gooien niet meer maar geven `context.access` door (de staff-client zit alleen in de geslaagde uitkomst), de handler geeft de 42501 als data terug, dus "U heeft geen toegang tot deze actie." komt in de browser aan; staff-dialogen tonen fouten inline én als toast; P5-B: instellingen- en teamfouten inline én als toast; servergedeelde helpers (`serviceFailure`, `screenBase`) staan nu in `src/server/fn-helpers.ts` (de import-bescherming van TanStack Start weigerde ze in een gedeelde module die ook in de browser zit); P7-B: alle factuuracties als server function met fouten als data (de Nederlandse databasemelding, bijv. "Op factuur … staan betalingen; maak die eerst ongedaan"), inline in de dialoog én als toast; succes-toasts melden sinds P8 de echte e-mailuitkomst; P9: laadfouten van historie en auditlog met "Opnieuw proberen", exportfout als toast met de Nederlandse melding, een periode "van" na "tot en met" inline (er wordt dan niets gevraagd) |
| 30 | Geen statische demo | ok (P2b, P3-A, P3-B) | geen placeholder-cijfers; alles uit Supabase met de client van de klant (RLS), query-keys `["portal", userId, …]`, plus een expliciet filter op `customer_id`; enige "binnenkort"-tekst is de door §35.8 voorgeschreven melding zonder US-adres |
| 31 | End-to-end acceptatietest | niet gestart | P10 |
| 32 | Ontwikkelaanpak | lopend | fasen volgens §35.1 |
| 33 | Ontwerpprincipe | ok (P2b, P3-A, P4) | geen gradients/glas/paars; tabellen met crème kop en vette bruine labels (orderlijst, facturen, zendingen, statussen), kaarten op mobiel |
| 34 | Alleen vragen indien nodig | lopend | |
| 35 | Aanvullende specificaties | deels | §35.0 (UI alleen Nederlands, `src/lib/i18n/nl.ts`), §35.2, §35.3 (P2a), §35.4, §35.6, §35.14 klaar; P3-A: §35.7 klantkant (orders lezen/wijzigen, annulering aanvragen, documenten, statussen per fase), §35.8 US-adreskaart en `service_rates.enabled` in het wijzigformulier, §35.10 factuurbadges en saldo per valuta; P3-B: §35.7 klant-INSERT (alleen klant-bewerkbare kolommen + `customer_id` uit de database + `parent_order_id`), §35.8 `service_rates.enabled` in het aanmeldformulier en `max_open_orders_per_customer` (fout 54000 netjes getoond), §35.14 verplicht vinkje verboden goederen; overige subsecties in latere fasen; P4-A: §35.2 (privileged writes via server functions met `requireStaff`, staff-client, geen service role), §35.4 (staff doen alle orderwerk; geen admin-only actie geraakt), §35.7 staff-kant (statusvoorwaarden, ontvangen, afhalen met `pay_before_pickup` + override, actie vereist, B2B-waarschuwing, orders voor klanten zonder login, extra pakketten), §35.8 `delivery_available` en `pay_before_pickup`, §35.12 haakpunt "max. één e-mail per klant per actie", §35.13 leesbare statushistorie; P4-B: §35.4 (statussen wijzigen alleen beheerders, zendingen alle staff), §35.7 zendingen (staff-only batches, zelfde verzendwijze, "Status voor hele zending wijzigen" via `change_order_status`, klanten zien een zending alleen met een eigen order erin) en statussen (flexibel, per fase, deactiveren in plaats van verwijderen, "Bezorgd" alleen bij `delivery_available`); P5-A: §35.5 (klant toevoegen, code wijzigen, deactiveren met `ban_duration`), §35.6 (uitnodigen, opnieuw versturen/intrekken, `/invite` paden a/b/c, staff-uitnodiging inwisselen), §35.12 WhatsApp-delen van uitnodigings- en resetlinks (e-mail P8: geen e-mail, de dialoog zegt dat); P5-B: §35.2 Systeemstatus (alleen booleans), §35.4 teampagina (staff lezen, beheerders: medewerker/beheerder uitnodigen met dezelfde tokenregels als klanten, rol wijzigen via `set_user_role` met bescherming van de laatste beheerder, login deactiveren/activeren met reden, resetlink), §35.8 volledig (`/admin/instellingen`: bedrijfsgegevens, facturen, herinneringen, werkwijze, afhalen, voorwaarden/verboden goederen, nummering, bankrekeningen, US-adressen, tarieven; beheerders wijzigen, staff lezen; setup-checklist op het dashboard), §35.9 `set_invoice_counter` (huidig jaar, geweigerd zodra er een factuur is), §35.5 `set_next_customer_number`; P6/P7-A: §35.9 bouwer, concepten, uitgeven via `issueInvoiceFn`, vracht één keer per order, totalen TS == SQL; §35.10 één valuta per factuur, BTW inclusief ("Waarvan BTW"), `formatMoney`/`formatLbs`/dd-mm-jjjj op de factuur; §35.11 factuurdocument (één renderer, exacte sjabloonkleuren, papierformaat, print-CSS, statusmarkeringen); §35.12 P8-haak "factuur aangemaakt" zonder e-mailclaim; P7-B: §35.9 annuleren/corrigeren (`replaces_invoice_id`), zichtbaarheid (klant nooit concepten, nooit ongedaan gemaakte betalingen); §35.10 betalingen (bedrag in factuurvaluta, ontvangen bedrag/valuta ter informatie, "Markeer als betaald" = volledig saldo), ongedaan maken, afgeleide status, achterstallig uit de view, opslag, totalen en saldo per valuta, betaalinstructie; §35.11 print-routes (alleen het document, `document.fonts.ready` + logo, `window.print()`, titel `{nummer} - G&R Solutions`, app-chrome verborgen bij printen); §35.12 "Deel via WhatsApp" voor uitgegeven facturen (portallink alleen voor klanten met login, op APP_URL), P8-haak "betaling ontvangen" zonder e-mailclaim; P8: §35.2 (Systeemstatus: e-mailprovider, CRON_SECRET, laatste herinneringsronde), §35.12 volledig (sendEmail, sjablonen, idempotentiesleutels, herinneringen, cron-route, pg_cron + pg_net + Vault, `/admin/herinneringen`; sinds de reviewronde ook "Deel via WhatsApp" bij statuswijzigingen en ontvangen en op elke herinneringsregel); P9: §35.13 (generieke auditweergave met JSON-lade, leesbare tijdlijnen), §35.15 "Exporteer CSV" (klanten, orders, facturen met regels, betalingen, auditlog) en per-jaar-aggregaten uit de RPC `customer_history_by_year` |

## Bewijs P8/P9 reviewronde (2026-10-07)

17 bevindingen nagelopen (allemaal echt). Niets live toegepast, de echte Resend-API nooit
aangeroepen (tests mocken `fetch`; de browsercontrole draait tegen een lokale Supabase-stub).

| # | Bevinding | Uitkomst |
| - | --------- | -------- |
| 1 | Handmatige herinnering na de dagelijkse op dezelfde dag (tweede e-mail, `reminder_count` +2) | opgelost: `sendInvoiceReminderNow` weigert (`already_today`) als er die Surinaamse dag al een herinnering is geboekt (`last_reminder_sent_at`) of in `email_logs` staat (sent/queued, elke route); als de dagelijkse ronde die herinnering vandaag toch zou sturen gebruikt de knop dezelfde sleutel (`invoice:<id>:<kind>:<seq>`), dus ronde + klik tegelijk = één e-mail; `sentToday` in de UI met dezelfde regel (`remindedOn`) |
| 2 | Ongeknipte `.in()`-lijsten, geen paginering in de ronde | opgelost: `inIdChunks` (100 per keer) in `dueSoonSent` en `loadIssuedInvoices`; kandidaten per pagina van 1000 (`range`), facturen na de vervaldatum met alle herinneringen gehad vallen af; de "vóór vervaldatum"-controle alleen voor facturen vóór hun vervaldatum |
| 3 | `revoke … net` doet niets op Supabase (niet-eigenaar), alleen waarschuwingen; claims en test onjuist | opgelost: de REVOKEs en de waarschuwing zijn uit de (nog niet toegepaste) P8-migratie; stub volgt pg_net ≥ 0.12 + Supabase-hook (USAGE/EXECUTE voor PUBLIC, security invoker); test bewijst nu: geen functie die anon/authenticated/service_role mag aanroepen gebruikt `net.http_*`, en een REVOKE als niet-eigenaar is een no-op; DEPLOYMENT §2.1/§7.4 en rij 27 gecorrigeerd (afscherming = `net` niet in "Exposed schemas") |
| 4 | Ronde zonder tijdslimiet-instelling; "running" blijft hangen | opgelost/gedocumenteerd: DEPLOYMENT §1.1 Fluid compute aan + Max Duration ≥ 90 s; de volgende ronde zet rijen die > 15 min "running" staan op mislukt ("Afgebroken: …"); UI en Systeemstatus tonen "Afgebroken"; restrisico (herhaling na 24 h bij afbreken precies tussen Resend en boeken) in de open punten |
| 5 | Kapotte planning onzichtbaar; handmatige ronde verbergt het | opgelost: Systeemstatus toont "Laatste automatische ronde" apart; checklist waarschuwt bij CRON_SECRET ontbreekt of > 26 h geen automatische ronde ("nog nooit" apart); DEPLOYMENT §7.2: `app_url` zonder doorverwijzing (curl zonder -L, 401 goed, 307/308 fout) |
| 6 | Geen WhatsApp op herinneringsregels met e-mailadres | opgelost: "Herinner via WhatsApp" op elke openstaande factuur (prominent zolang e-mail uit staat of de klant geen adres heeft), met portallink voor klanten met login (`emailStatusFn` geeft de linkbasis mee) |
| 7 | Geen WhatsApp na statuswijziging | opgelost: de server geeft per klant zonder verstuurde statusupdate een kant-en-klaar bericht terug (`statusFollowUps`: orders, status, omschrijving, bericht, afhaalgegevens, portallink alleen met login); het statusvenster toont "Klanten zelf informeren" met een WhatsApp-knop per klant; ontvangen: knop "Via WhatsApp" in de melding (scanflow blijft lopen) |
| 8 | "Beste klant," in uitnodiging voor het team | opgelost: "Goedendag," zonder naam (`greeting(…, fallback)`) |
| 9 | "N.V.." | opgelost: `endSentence()` in de teamuitnodiging en "factuur aangemaakt" |
| 10 | Bedragen onder "Prijs per lbs" | opgelost: tabel Items \| Gewicht × prijs per lbs \| Bedrag (ook het bedrag van de vrachtregel), tekstversie "… · Bedrag: USD 45,00"; 375 px zonder woordbreuk of horizontale scroll |
| 11 | DEPLOYMENT over de service role in P8 | opgelost: §1.2 noemt e-mailadministratie, herinneringen, cron en opruimen; §6: `skipped_no_provider`-regels alleen met de sleutel |
| 12 | Tijdlijn: uitgegeven totaal na opslag | opgelost: "uitgegeven · Totaal" = totaal min de opslagregel; de opslag-gebeurtenis toont "Opslag USD 36,75 · nieuw totaal USD 281,75" |
| 13 | "vóór" vs "uiterlijk op" | opgelost: preheader en herinnering vóór de vervaldatum zeggen "uiterlijk op" |
| 14 | "2 was al eerder verstuurd" | opgelost: `duplicateOne`/`duplicateMany` ("2 waren …") |
| 15 | Meervoudslabels bij één historieregel | opgelost: `portal.history.typeOne` (Order, Zending, Factuur, Betaling, Statuswijziging) |
| 16 | Auditrecord "true" / uuid | opgelost: "Bedrijfsinstellingen" en US-adres als label · stad |
| 17 | Handmatig voorbij het maximum, "4 van 3" | opgelost: server weigert (`max_reached`) zonder `confirmMax`; knop "Toch herinneren" met bevestiging; teller toont "4 na vervaldatum (maximum 3)" |

- Migratie `20261008090000_p8_reminders.sql` (nog NIET live): alleen de pg_net-REVOKEs en de
  waarschuwingslus eruit, kop bijgewerkt; schema, functies, job en grants verder ongewijzigd.
- Reviewtests omgezet en verwijderd (`review_p8_same_day`, `review_p8_net_revoke`,
  `review_p8_ux_copy`): `email_contract.test.ts` (nu 14: ronde → knop zelfde dag, sleutel van
  de ronde, extra tussen rondes, maximum, afgebroken runs, uitgefilterde facturen),
  `p8_reminders.test.ts` (pg_net zoals op Supabase, geen client-functie naar pg_net, REVOKE als
  niet-eigenaar is een no-op), `templates.test.ts` (teamgroet, N.V., kolom Bedrag, uiterlijk op);
  nieuw `notification-data.test.ts`, `status-share.test.ts`, uitbreidingen in
  `lib/email/reminders.test.ts`, `lib/admin/reminders.test.ts`, `system-status.test.ts`,
  `order-notifications.test.ts`, `outcome.test.ts`, `audit.test.ts`.
- Browser (dev-server tegen lokale stub, e-mail uit, 1440 en 390 px): `/admin/herinneringen`
  met 5 WhatsApp-knoppen (ook voor klanten met e-mailadres), "Vandaag al verstuurd" na de
  ronde, "Toch herinneren" met bevestigingsvenster, rij "Afgebroken"; statuswijziging →
  "Klanten zelf informeren" met WhatsApp-bericht inclusief portallink; dashboard: "Laatste
  automatische ronde" en "CRON_SECRET ontbreekt…"; auditlog Bedrijfsinstellingen; historie met
  "STATUSWIJZIGING"/"ORDER"; factuurtijdlijn met opslag. Geen horizontale scroll, axe 0, geen
  consolefouten. E-mails op 640/375 px zonder horizontale scroll.

## Bewijs P9 deel B (2026-10-07)

Geen migratie: `customer_history_by_year`, `audit_log` (alleen beheerders lezen) en alle tabellen
van de export bestaan al met hun RLS (P2a). Geen server functions: historie, auditlog en export
lezen in de browser met de eigen client van de gebruiker (RLS), nooit de service role.

Nieuw:

- `src/lib/csv.ts`: CSV voor Nederlandse Excel: UTF-8 met BOM, `;` als scheiding, CRLF, getallen
  met komma zonder duizendtallen ("1234,50", half-up zoals de database), datums dd-mm-jjjj en
  tijdstippen dd-mm-jjjj uu:mm (Surinaamse tijd), "ja"/"nee", velden met `;`, `"` of een
  regeleinde tussen aanhalingstekens, tekst die met `= + - @` (of tab/CR) begint krijgt een
  apostrof (CSV-injectie), identificaties die Excel tot getal zou maken (trackingnummers van 22
  cijfers, voorloopnullen, "+597 …") als `="…"` zodat elk cijfer blijft; `csvFileName`
  (`gr-<naam>-<jjjj-mm-dd>.csv`), `downloadCsv` (Blob, niets opgeslagen).
- `src/lib/admin/exports.ts`: `exportCustomers`, `exportOrders` (statusnaam en fase, zending,
  hoofdorder), `exportInvoices` (één rij per factuurregel, factuur zonder regels één rij, concept
  = "Concept", "Vervangt factuur"), `exportPayments` (ook ongedaan gemaakte, met wie), `exportAudit`
  (alle pagina's die de filters treffen, met naam van wie, oude/nieuwe JSON). Kolomkoppen in
  `nl.ts` (`admin.exports.columns`). Een lijstpagina geeft de id's die de filters tonen mee, in die
  volgorde.
- `src/components/admin/ExportCsvButton.tsx`: knop of menu "Exporteer CSV", alleen voor
  beheerders op `/admin/klanten`, `/admin/orders`, `/admin/facturen` (menu: "Facturen met regels",
  "Betalingen van deze facturen") en `/admin/audit`; toast met bestandsnaam en aantal regels.
- `src/lib/admin/audit.ts` + `src/routes/admin/audit.tsx`: `/admin/audit` (nav "Auditlog", alleen
  beheerders; een medewerker krijgt uitleg en geen query), filters in de URL en in de database
  (`table_name`, `actor_id`, `occurred_at` ≥ 00:00 van "van" en < 00:00 na "tot en met" in
  Suriname, `record_id`), 50 per pagina (51 gelezen voor "Volgende"), lade met `auditDiff`,
  `auditRecordLabel`, `auditRecordLink` en de volledige JSON.
- `src/lib/admin/invoice-timeline.ts` + `src/components/admin/invoices/InvoiceTimeline.tsx`:
  kaart "Geschiedenis" op de factuurpagina uit factuur + betalingen (geen auditlog nodig, dus ook
  voor medewerkers); `INVOICE_VIEW_COLUMNS` leest nu ook `created_at, created_by`.
- `src/lib/portal/history.ts` + `src/routes/portal/historie.tsx`: zie §20. Query-sleutel
  `["portal", userId, "orders", { view: "history" … }]`: onder "orders" (ververst met elke
  orderwijziging), met een object als segment zodat geen order-id uit een URL dezelfde sleutel
  kan krijgen.
- Navigatie: portal "Historie" (na Facturen), admin "Auditlog" (alleen beheerders); `paths`
  `portalHistory`, `adminAudit`.
- Testhulp: `supabase-standin.ts` begrijpt nu `*` naast embeds (`*, customer:customers(…)`).

Tests (nieuw): `src/lib/csv.test.ts` (20: BOM als EF BB BF, `;`, komma-decimalen, half-up,
dd-mm-jjjj in Suriname, aanhalingstekens/regeleinden, CSV-injectie, `="…"` voor lange cijferreeksen
en telefoonnummers, elke rij evenveel velden, download als UTF-8-Blob),
`src/lib/admin/exports.test.ts` (Nederlandse kolommen en waarden per export, regels genummerd in
factuurvolgorde, JSON overleeft de CSV-quoting), `src/lib/admin/audit.test.ts` (filters,
dagbereik UTC−3, 51-rijen-paginering, geen query bij ongeldige periode, diff, labels, links),
`src/lib/admin/invoice-timeline.test.ts`, `src/lib/portal/history.test.ts` (records, jaren in
Suriname, zoeken zonder accenten/streepjes, jaartekst "12 orders, 8 zendingen, 7 facturen");
PGlite `supabase/tests/pglite/history_export_contract.test.ts` (de echte loaders met ieders eigen
client tegen alle migraties: Alice ziet 2 orders, 1 zending met beide orders, 1 factuur, 1
betaling en 4 klantzichtbare statuswijzigingen, nooit haar concept of Bobs order; de records
kloppen met `customer_history_by_year`; Bob met Alices id: geen rijen, RPC 42501; beheerder filtert
het auditlog op tabel/wie/dag/record, staff krijgt niets; exports als beheerder met
`="+597 8000003"`, `="9400111899223397658538"`, "Deels betaald", "Contant", "Sam Staff"; staff en
klant exporteren geen auditregels, de klant alleen eigen orders). Bijgewerkt: `nav.test.ts`,
`app-routing.test.tsx` (`/portal/historie`, `/admin/audit`, `/admin/herinneringen`).

Gecontroleerd (na de laatste wijziging): `bun run test` 87 bestanden, 1040 tests groen (1
skipped); `bunx tsc --noEmit` schoon; `bun run build` en `VERCEL=1 bun run build` slagen
(`.vercel/output` aanwezig; de bekende waarschuwing "inlineDynamicImports option is ignored" komt
uit de buildconfiguratie); eslint en prettier op de gewijzigde bestanden schoon; beschermde paden
(`src/integrations/supabase/*`, `vite.config.ts`, `.github/*`, bestaande migraties) niet
aangeraakt; `routeTree.gen.ts` alleen via de build. Browser (Playwright/Chromium tegen de
dev-server, Supabase in de browser gestubd met de P8-stub plus `customer_history_by_year` en
`audit_log`-filters; niets naar het live project; scripts in de scratchpad `p9b/`): klant Maria op
`/portal/historie`: jaarkaarten "2026: 8 orders, 1 zending, 2 facturen, 1 betaling" en "2025: 1
order, 1 factuur, 1 betaling", klik 2025 → `?year=2025`, soort Facturen + "inv-2026-0009" → 1
regel → opent `/portal/facturen/…` ("Factuur INV-2026-0009"), zending toont haar orders als links,
"94055000" vindt het trackingnummer met spaties; beheerder op `/admin/audit`: pagina 2 en terug,
filter Facturen → `table_name=eq.invoices`, lade met oud/nieuw, "Pagina openen" →
`/admin/facturen/…`, "Alleen wijzigingen door Ada Admin" → `?actor=…`, periode van > tot →
melding en 0 queries, periode + record → `gte`/`lt` in Surinaamse tijd; exports: klanten (17 van 25
met filter actief), orders (9 met zoekterm), facturen met regels, betalingen en auditlog,
elk met BOM `ef bb bf`, `;`, komma-decimalen en dd-mm-jjjj; medewerker: geen "Auditlog" in de nav,
uitleg op `/admin/audit`, geen exportknoppen, geen auditquery; factuurpagina: "Geschiedenis" met
betaling (door Maria Staff), uitgifte en concept. 320/390/768/1024/1440 px zonder horizontale
scroll; axe (wcag2a/aa) 0 overtredingen op historie, auditlog en de lade; geen consolefouten.

## Bewijs P8 deel A (2026-10-07)

Uit het rapport van deel A, in de eindronde van deel B opnieuw gedraaid (alle tests groen,
beide builds slagen). Niets live toegepast, de echte Resend-API nooit aangeroepen (tests mocken
`fetch`, de browsercontrole een Resend-mock in het dev-serverproces).

- Migratie `supabase/migrations/20261008090000_p8_reminders.sql` (nog NIET live toegepast):
  pg_cron (schema pg_catalog) en pg_net (schema extensions); [in de reviewronde gecorrigeerd:
  het intrekken van `net.*` voor anon/authenticated werkte op Supabase niet en is eruit, zie
  "Bewijs P8/P9 reviewronde"]; `private.invoke_payment_reminders()` (SECURITY DEFINER, lege
  search_path, leest Vault `app_url` + `cron_secret`, alleen https (of http op localhost), POST
  naar `<app_url>/api/cron/payment-reminders` met Bearer, doet niets zonder secrets);
  `cron.schedule('gr-payment-reminders', '0 12 * * *', …)` idempotent (bestaande kopieën eerst
  weg); `public.orphan_order_document_objects()` (alleen service_role) voor de opruimstap. Geen
  RLS-wijziging nodig voor `email_logs`/`job_runs` (staff lezen, service role schrijft).
- Server: `src/server/email.ts` (`sendEmail`), `email-templates/*`, `notification-data.ts` (inhoud
  met de client van de handelende gebruiker, RLS), haken in `order-`, `invoice-` en
  `invitation-notifications.ts`, `reminders.ts`, `cron-secret.ts`, `cron-payment-reminders.ts`,
  `storage-cleanup.ts` (verweesde uploads > 24 h in `order-documents`, in blokken van 100,
  job `storage_cleanup`), `admin-client.ts` (`loadStorageAdmin`). Service role alleen voor de
  `email_logs`-administratie (ook bij klant- en anonieme verzoeken) en de herinneringsronde na
  CRON_SECRET. Route `src/routes/api/cron/payment-reminders.ts`; server functions
  `runRemindersFn` (staff), `sendInvoiceReminderFn` (factuur eerst zichtbaar onder RLS),
  `emailStatusFn`. Sleutels in `src/lib/email/keys.ts`: `invoice:<id>:<kind>:<seq>` (handmatig
  `…:manual-<datum>`), `order:<id>:order_confirmation:1`, `order:<eerste>:status:<laagste
  history-id>`, `invite:<id>:<send_count>:<Surinaamse dag>`, `invite:<id>:welcome`.
- UI: echte uitkomst bij statuswijziging, ontvangen, nieuwe order, factuur uitgeven, betalingen,
  uitnodigen (klant en staff); e-mails per factuur op de factuurpagina; `/admin/herinneringen`
  (nav "Herinneringen").
- Tests: `server/email.test.ts` (15), `email-templates/templates.test.ts` (10), herschreven
  haaktests, `cron-payment-reminders.test.ts` (7), `storage-cleanup.test.ts` (4),
  `lib/email/*.test.ts`, `lib/admin/reminders.test.ts`, PGlite `p8_reminders.test.ts` (11) en
  `email_contract.test.ts` (9).
- Docs: DEPLOYMENT §2.1, §4, §5, §6 (Resend: domein, sleutel, Vercel Production-variabelen,
  custom SMTP), §7 (CRON_SECRET, Vault-SQL, cronjob controleren, curl-test).
- Browser (deel A, gestubd): `/herinneringen`, factuurpagina, statuswijziging en uitnodigingen
  op 1440 en 390 px, met en zonder e-mailconfiguratie; tweede ronde verstuurt niets, een
  overgeslagen herinnering wordt niet geboekt; e-mails op 640/375 px zonder horizontale scroll.

## Niet geverifieerd / open punten na P8/P9

- Niets live: migratie `20261008090000_p8_reminders.sql` toepassen, Vercel Production
  `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_REPLY_TO` (optioneel), `APP_URL`, `CRON_SECRET` zetten,
  het domein in Resend verifiëren, de Vault-secrets `app_url` en `cron_secret` aanmaken
  (DEPLOYMENT §7.2) en Resend als custom SMTP in Supabase Auth instellen (§6.3). Daarna een echte
  e-mail en één cronronde controleren (`email_logs`, `job_runs`).
- Een open uitnodigingslink kan in latere e-mails niet opnieuw worden meegestuurd (alleen de hash
  staat in de database); die e-mails noemen de uitnodiging.
- De herinneringsronde heeft een budget van 45 s; wat niet lukt staat als "uitgesteld" en gaat
  mee in de volgende ronde of met "Herinneringen nu versturen". Vercel: Fluid compute aan en
  Function Max Duration ≥ 90 s (DEPLOYMENT §1.1), anders wordt een grotere ronde afgebroken.
- Restrisico: wordt de functie afgebroken precies tussen het accepteren door Resend en het
  vastleggen in `email_logs`, dan blijft de regel 'queued' en stuurt de volgende ronde (24 h
  later, buiten Resend's idempotentievenster) dezelfde herinnering opnieuw. Klein venster; niet
  opgelost zonder de kans op een gemiste herinnering.
- pg_net is op Supabase uitvoerbaar voor PUBLIC en dat kan een migratie niet veranderen; de
  owner controleert eenmalig dat `net` niet in Data API → Exposed schemas staat (§7.4).
- Na `createOrderForCustomerFn` met directe ontvangst toont het venster geen WhatsApp-knop voor
  de statusupdate (wel de uitkomst); bij statuswijziging en "Ontvangen" wel.
- Historie: de jaarkaarten tellen zoals de RPC (geannuleerde facturen niet), de lijst toont
  geannuleerde facturen wel (met badge "Geannuleerd"); statuswijzigingen tellen niet mee in de
  kaarten (de RPC telt ze niet), maar hun jaar staat wel in de jaarkeuze.
- Klanten hebben geen eigen zendingpagina: een zending in de historie linkt naar de eigen orders
  erin.
- "Exporteer CSV" laadt de volledige tabel en houdt in de browser de getoonde id's over; bij
  zeer grote aantallen (tienduizenden orders) wordt dat traag. Het auditlog exporteert alle rijen
  die de filters treffen.
- In het auditlog staan bedragen in de JSON zoals de database ze opslaat ("281.75"); de
  export en de rest van de app tonen komma-decimalen.
- Exportbestanden en de historie zijn in Chromium gecontroleerd; het openen in Excel zelf
  (Nederlandse landinstelling) niet: dat is een owner-test (P10, ACCEPTANCE.md).
- Live Supabase niet aangeraakt.

## Bewijs P6/P7 reviewronde (2026-10-07)

Geen migratie: elke bevinding is in de app op te lossen (de database weigerde al terecht een
negatief tussentotaal; de app schrijft nu in een veilige volgorde). Review-testbestanden
`review_p6_save_order.test.ts` en `review_p6_amount.test.ts` zijn omgezet naar vaste tests en
verwijderd.

| # | Bevinding | Uitkomst |
|---|---|---|
| 1 | 8 regels + BTW/opmerking/bedrijf/KKF → 2 pagina's (Letter) | opgelost: verticale ruimte strakker (logoband 1in, rijen 0,3in, kop/samenvatting/bank/kopjes compacter); lege opvulrijen tellen elke extra samenvattingsregel mee (`itemPaddingRows`); kleine facturen (≤ 5 items, ≤ 3 samenvattingsregels) blijven ruim zoals het sjabloon (`documentDensity` "roomy": logoband 1,3in, rijen 0,36in). 8 vrachtregels + BTW + opmerking + bedrijfsnaam (2 regels) + KKF/BTW-regel: 1 pagina Letter (12 px over), 1 pagina A4 |
| 5 | Totaalregels zonder herhaalde kop op pagina 2 | opgelost: samenvatting is de tweede `<tbody class="gr-inv-totals">` van de itemtabel; `break-before: avoid` op de totaalrijen (op de tbody zelf verschuift Chromium de hele tabel) houdt minstens de laatste itemregel bij de totalen; betaalblok en voorwaarden blijven samen en bij de totalen |
| 2 | Toast geprint op de PDF | opgelost: `styles.css` verbergt `[data-sonner-toaster]` bij printen; de print-route roept `toast.dismiss()` vóór `window.print()` |
| 3 | Stempel BETAALD over lange adresregels | opgelost: stempel "BETAALD" boven de datum (twee regels, ±1,2in breed) in de contactblok-marge; bij een betaalde factuur houdt het contactblok links en rechts 1,3in vrij (symmetrisch, regels blijven gecentreerd en lopen door) |
| 4 | Footer afgekapt (`white-space: pre`) | opgelost: `pre-wrap` (dubbele spaties blijven); de ruimte onderaan elke pagina is een onzichtbare kopie van de footertekst, dus een footer van twee regels krijgt twee regels ruimte |
| 6, 12 | Voorbeeld onleesbaar op 1024–1279 px | deels: kolommen gelijk verdeeld (schaal 0,365 → 0,375 op 1024) en knop "Vergroten" opent het document op ware grootte in een venster (schaal 0,985); de tabs blijven onder 1024 px zoals §35.11 voorschrijft |
| 7 | `saveDraft` weigert geldige bewerkingen (tussentotaal < 0) | opgelost: kortingen eerst op 0/verwijderd, dan kostenregels verwijderen/kop/bijwerken/toevoegen, kortingen als laatste; het lopende totaal komt nooit onder het eindtotaal |
| 9 | Mislukte eerste opslag laat leeg concept achter | opgelost: worden de regels geweigerd, dan verwijdert `saveDraft` de net gemaakte factuurrij weer; de foutmelding zegt nu "niet (volledig) opgeslagen" i.p.v. "opgeslagen" bij een mislukte opslag |
| 8 | "1.250" geboekt als USD 1,25 | opgelost: `parseMoneyInput` (punt + precies 3 cijfers is onduidelijk → "Bedoelt u USD 1.250,00? Typ het bedrag zonder punt, bijv. 1250 of 1250,00."; "1.250,00", "1.250.000", "1250.50" en "1,250.50" werken); onder het veld "Wordt geregistreerd als …" |
| 10 | "Markeer als betaald" betaalt een nieuw saldo | opgelost: `markPaidFn` stuurt het saldo uit de dialoog als bedrag; gedaald → database weigert, gestegen → deels betaald met uitleg in de toast; het formulier wordt alleen bij openen gevuld, een saldowijziging terwijl het open is geeft een melding |
| 11 | "Corrigeren" verlaten zonder waarschuwing, geen herstel | opgelost: een correctie blijft "Niet opgeslagen" tot het concept is opgeslagen (waarschuwing bij weggaan, met uitleg); een geannuleerde factuur zonder vervanger toont "Vervangende factuur maken" (bouwer met `replaces`, klant en orders) |
| 13 | Opslaan/uitgeven niet op het tabblad Voorbeeld | opgelost: totaal + "Genereer factuur" + "Opslaan als concept" ook onder het voorbeeld (alleen < 1024 px); een fout springt terug naar Gegevens |
| 14 | Intro "links … rechts" klopt niet op telefoon | opgelost: "Kies een klant en de orders en vul de factuur in. Het voorbeeld toont hem zoals de klant hem krijgt." |
| 15 | Pijlen veranderen niets op papier | opgelost: pijlen alleen bij vrachtregels (onderling) en "Overige kosten" (onderling, slaan andere regels over); uitleg in de intro van Regels |
| 16 | Lege omschrijving verplicht bij handmatige regel | opgelost: omschrijving = de soort (behalve "Overige kosten", die op papier staat); bij wisselen van soort volgt een standaardtekst de soort, getypte tekst blijft |
| 17 | Factuurdatum zonder zichtbaar label in de klantlijst | opgelost: eigen kolom "Datum" |

Tests: `InvoiceDocument.test.tsx` (totalen in de itemtabel, opvulling, stempel in het
contactblok, footer-kopie), `model.test.ts` (`itemPaddingRows`, `documentDensity`, stempeldatum),
`InvoicePrintView.test.tsx` (`toast.dismiss` vóór `print`), `invoice-builder.test.ts` (verplaatsen
per groep, standaardomschrijvingen, soort wisselen), `invoice-actions.test.ts` (geldbedragen,
"1.250"/"1.000" onduidelijk, `_amount` bij markeren), `InvoiceDialogs.test.tsx` ("1.250" geweigerd
+ echo, saldowijziging tijdens open dialoog, markeren met bedrag); PGlite
`invoice_builder_contract` (drie bewerkingen die naïef < 0 zouden gaan, nu opgeslagen met het
juiste totaal; geweigerde eerste opslag laat geen factuurrij achter), `invoices_contract`
("Markeer als betaald" met verouderd saldo: gedaald → 22023, gestegen na ongedaan maken →
deels betaald met 7,00 open).

Gecontroleerd: `bun run test` 70 bestanden, 880 tests groen (1 skipped, tijdsafhankelijk);
`bunx tsc --noEmit` schoon; eslint en prettier op de gewijzigde bestanden schoon; `bun run build`
en `VERCEL=1 bun run build` slagen. Print (Chromium `page.pdf`, `preferCSSPageSize`, echte CSS,
fixtures via `fromIssuedInvoice`): Letter 1 pagina voor 8 vracht, 8 + BTW, 8 + opmerking,
8 zakelijk, 8 + alles (BTW, opmerking, bedrijfsnaam van 2 regels, KKF/BTW-regel, ook betaald),
5 + douane/korting/opslag, 1 vracht + 7 kosten + alles, 4 + 4 + alles, 5 + alles met lange
adresregel en stempel; 2 pagina's voor 9, 12, 12 + kosten, 24 vracht en 3 + 8 kosten: pagina 2
begint steeds met de bruine kop, minstens één itemregel, dan totalen, opmerkingen, betaalblok en
voorwaarden; lange footer op 2 regels, niets afgekapt. In de app (dev-server naar een lokale
mock, niets naar het live project): `/admin/facturen/$id/print` met 8 regels + BTW + opmerking
→ Letter 1 pagina, A4 1 pagina; 12 regels → Letter 2 pagina's (11 | 1 + totalen, kop herhaald);
klant kopieert de referentie, "Opslaan als PDF" → toast niet in de PDF; "Corrigeren" →
weggaan geeft de waarschuwing, de geannuleerde factuur toont "Vervangende factuur maken" →
bouwer met "vervangt …"; 390/768: knoppen zichtbaar op Voorbeeld; 1024/1440: "Vergroten" →
schaal 0,985; betaling "1.250" geweigerd, niets geboekt; klantlijst met kolom Datum.

## Niet geverifieerd / open punten na P6/P7 reviewronde

- Een concept opslaan blijft meerdere verzoeken (geen transactie). Mislukt een latere stap van
  een bestaand concept (bijv. vracht al op een ander concept), dan kan het concept half
  bijgewerkt zijn (kortingen tijdelijk 0); de bouwer houdt alles in beeld en opnieuw opslaan
  brengt het in orde. Een transactionele opslag-RPC zou een migratie vragen.
- "Corrigeren" blijft twee stappen (annuleren, dan het nieuwe concept opslaan); weggaan
  waarschuwt nu en de geannuleerde factuur biedt "Vervangende factuur maken", maar wie toch
  weggaat laat de klant even zonder vervangende factuur.
- Op 1024–1279 px is het voorbeeld naast het formulier klein (schaal ±0,38); "Vergroten" toont
  het op ware grootte.
- De paginacontrole (aantal PDF-pagina's) draait met Playwright in de scratchpad
  (`review-6/shoot.mjs`, `variant.mjs`, `specux/fixcheck.mjs`), niet in `bun run test`
  (Playwright is geen projectafhankelijkheid).
- Heel lange bedrijfsnamen, beschrijvingen of adressen kunnen een factuur van 8 regels nog
  steeds naar 2 pagina's duwen; dan blijven totalen, betaalblok en voorwaarden samen met de
  laatste itemregel onder een herhaalde kop.
- Printen alleen in Chromium gecontroleerd; Safari/Firefox niet. Live Supabase niet aangeraakt.

## Bewijs P6/P7 deel B (2026-10-07)

Geen migratie: elke actie bestaat al als RPC of view (P2a + reviewrondes). Alle schrijfacties
via server functions met de eigen client van de medewerker (`requireStaff`/`requireAdmin`,
zod, fouten als data); nooit de service role.

Server functions (`src/lib/server-fns/invoices.functions.ts`, werk in
`src/lib/admin/invoice-actions.ts`):

| Functie | Wie | RPC / tabel | Haak |
|---|---|---|---|
| `recordPaymentFn` | staff | `record_payment` met bedrag (≤ saldo, niet in de toekomst) | `onPaymentRecorded` (P8: e-mail alleen bij 'paid') |
| `markPaidFn` | staff | `record_payment` met het saldo uit de dialoog (reviewronde; eerst zonder bedrag) | idem |
| `voidPaymentFn` | beheerder | `void_payment` (reden) | — |
| `cancelInvoiceFn` | beheerder | `cancel_invoice` (reden, zichtbaar voor de klant) | — |
| `applyLateFeeFn` | beheerder | `apply_late_fee` | — |
| `invoiceShareFn` | staff | leest `invoices` + `customers` (RLS) | geeft de portallink (APP_URL, anders de origin) alleen bij een login |

Pagina's: `src/routes/admin/facturen/index.tsx` (lijst), `admin/facturen/$id.tsx` →
`components/admin/invoices/IssuedInvoiceView.tsx` + `InvoiceDialogs.tsx`,
`routes/portal/facturen/index.tsx`, `portal/facturen/$id.tsx`, print-routes
`routes/admin_.facturen.$id_.print.tsx` en `routes/portal_.facturen.$id_.print.tsx` (de
underscores houden ze buiten de `/admin`- en `/portal`-layout; eigen `requireArea`, `ssr:
false`, loader zet de titel) met `components/invoice/InvoicePrintView.tsx`. Queries:
`lib/admin/invoices.ts` (lijst, zoeken, filters, periode, totalen), `lib/admin/invoice-queries.ts`
(betalingen, vervangen/vervangt), `lib/portal/invoices.ts` (klantlijst en -factuur).
"Corrigeren" houdt de valuta van de geannuleerde factuur (kleine aanvulling in de bouwer).
Afdrukken van een factuurpagina (Ctrl+P) drukt ook alleen het document af: `AppShell` verbergt
zijbalk en kop bij printen, de pagina's verbergen alles behalve het document.

Tests: `admin/invoices.test.ts` (zoeken, filters, periodes, sorteren, totalen per valuta),
`admin/invoice-actions.test.ts` (schema's, RPC-argumenten, "Markeer als betaald" zonder bedrag,
formulierfouten, opslag half-up, WhatsApp-tekst met/zonder portallink),
`InvoiceDialogs.test.tsx` (alle fouten + focus, geen e-mailclaim, betalingen geblokkeerd bij
annuleren, "Corrigeren" navigeert met `replaces`, opslagbedrag vooraf, WhatsApp zonder login
zonder link), `InvoicePrintView.test.tsx` (titel, één `window.print()` ook in StrictMode),
`totals.test.ts` (`lateFeeAmount`), `portal/invoices.test.ts`, `keys.test.ts`, `nav.test.ts`,
`app-routing.test.tsx` (routes, print-routes zonder layout, client-only),
`invoice-notifications.test.ts`. PGlite `supabase/tests/pglite/invoices_contract.test.ts` draait
de app-code ongewijzigd met de eigen client van elke persoon (`supabase-standin.ts`: embeds,
filters, `rpc` set/rij zoals PostgREST): concepten in de staff-lijst maar nooit bij de klant (ook
niet per id of zonder app-filters), uitgeven → klant ziet de factuur uit de snapshots,
deelbetaling → 'Deels betaald', te veel/toekomst geweigerd (22023), "Markeer als betaald" →
'Betaald' met `paid_at`, nog eens betalen 55000, klant ziet betalingen met bericht; ongedaan
maken: staff 42501, beheerder met reden → 'Openstaand', klant ziet de betaling niet meer, staff
wel met reden, tweede keer 55000; annuleren: staff 42501, met betalingen 55000 (Nederlandse
melding), daarna geannuleerd met reden zichtbaar voor de klant, betaling daarna 55000,
vervangend concept met `replaces_invoice_id` uitgegeven, relaties beide kanten; opslag: niet
achterstallig 55000, na veroudering is `lateFeePreview` == wat de database toevoegt (saldo 45,10
→ 6,77, het half-up-randgeval; gecontroleerd dat de test faalt met afkappen), één keer, staff
42501, klant ziet het nieuwe totaal; klant: uitgeven, betalen, markeren, ongedaan maken,
annuleren en opslag 42501, direct in `payments` 42501, `invoices` bijwerken raakt geen rij;
lijsttotalen USD en SRD apart.

Gecontroleerd: `bun run test` 70 bestanden, 869 tests groen (1 skipped); `bunx tsc --noEmit`
schoon; `bun run build` en `VERCEL=1 bun run build` slagen; eslint op de gewijzigde bestanden
schoon. Browser (Playwright/Chromium, dev-server met `SUPABASE_URL` naar een lokale mock,
Supabase in de browser gestubd; niets naar het live project; scripts in de scratchpad
`p7b/`): lijst met totalen per valuta, zoeken "gr 42" en op orderreferentie, filters
achterstallig/SRD/periode/concepten; als medewerker op INV-2026-0007 (achterstallig): bedrag
boven saldo → foutmelding + focus, USD 45,00 met referentie, SRD-ontvangst en bericht →
'Deels betaald' (`record_payment` vanaf de server), toast "geen e-mail verstuurd";
WhatsApp-bericht met portallink en wa.me/5978897500; als beheerder: opslag toont USD 30,00 en
het nieuwe totaal vóór bevestigen, daarna regel "Opslag te late betaling (15%)" op het document;
betaling ongedaan maken (reden verplicht), "Markeer als betaald" → stempel "BETAALD
07-10-2026"; annuleren met betalingen → uitleg, geen knop; "Corrigeren" van een SRD-factuur →
geannuleerd met reden, bouwer met "vervangt … INV-2026-0011", valuta SRD en de order; print-route:
titel "INV-2026-0009 - G&R Solutions", `window.print()` één keer, geen shell; PDF Letter 1
pagina, 21 regels = 2 pagina's (Letter en A4 uit de snapshot) met herhaalde kop en footer;
Ctrl+P op de factuurpagina = alleen het document; klant: nav en KPI-link, lijst zonder
concepten, "Nog te betalen" per valuta, filter, factuurpagina met betaalblok (SRD zonder
rekening → "neem contact op"), betaalde factuur "volledig betaald op …", eigen concept en
andermans factuur → niet gevonden, print-route; orderpagina en activiteit linken naar de factuur.
320/390/768/1024/1280/1440 px zonder horizontale scroll (ook alle dialogen); axe (390/1280):
alleen color-contrast op de footer (zie open punten).

## Niet geverifieerd / open punten na P6/P7 deel B

- De footer houdt de voorgeschreven #777777 (4,48:1, axe meldt het; zie deel A). De grijze
  naam onder een bedrijfsnaam op de factuur is nu #6B6B6B (4,5:1), net als de tracking-regel.
- Zonder APP_URL gebruikt de WhatsApp-portallink het adres waarop de medewerker werkt (de
  dialoog zegt dat, zoals bij uitnodigingen).
- "Corrigeren" zet de orders van de geannuleerde factuur opnieuw in de bouwer (vracht met het
  huidige gewicht en tarief); andere regels (douane, korting, …) worden niet gekopieerd.
- `payments.reference` is via RLS leesbaar voor de klant (zo in de migratie); de klantpagina
  toont alleen bedrag, datum, betaalwijze en het bericht voor de klant.
- E-mail ("factuur aangemaakt", "betaling ontvangen") en herinneringen: P8; de haken melden
  `emailed: false` en de UI zegt dat er geen e-mail is verstuurd.
- Printen alleen in Chromium gecontroleerd (ook `page.pdf`); Safari/Firefox niet.
- Live Supabase niet aangeraakt.

## Bewijs P6/P7 deel A (2026-10-07)

Geen migratie: elke regel van de bouwer bestaat al in de database (P2a + reviewrondes).
Alle schrijfacties met de eigen client van de medewerker; geen service role.

Factuurdocument (§35.11), `src/components/invoice/InvoiceDocument.tsx` +
`invoice-document.css` (vanuit `styles.css`, ook Inter 700):

- Eén renderer `InvoiceDocument({ model })` en `InvoicePreview` (ware grootte Letter 816×1056 /
  A4 794×1123 px, geschaald met `transform: scale()`, nooit opnieuw opgemaakt; print zonder
  schaal). Model in `src/lib/invoice/model.ts`: `fromDraftForm(form, liveSettings,
  bankAccounts, customer)` en `fromIssuedInvoice(row, items, snapshots)` (uitgegeven facturen
  alleen uit `issuer_snapshot`/`bill_to_snapshot` + opgeslagen totalen). Template-teksten
  letterlijk in `src/lib/invoice/labels.ts` (bewust niet in `nl.ts`: een factuur blijft
  Nederlands, ook als de UI later Engels krijgt).
- Blokken: logoband #EEEBE4 (1,1 in, max 1,9 in) met `gr-logo-banner.jpg`, titel 26 pt,
  contactregels 10 pt (KKF/BTW-regel alleen als ingevuld), infotabel 16/34/16/34 met
  "Naam klant:", "Unieke code:", "Datum:", "Invoicenummer:" (of CONCEPT), "Vervaldatum:",
  "Referentie:" (vanaf 4 orders met gedeeld voorvoegsel), items 54/22/24 met bruine kop
  (herhaald op elke pagina), alleen vrachtregels met grijze tracking/ref-regel, minimaal 5
  rijen, "Totaal lbs" in de Gewicht-kolom, overige kosten alleen als ≠ 0 (met "Vrachtkosten"
  als er andere rijen zijn, "Korting" als '– USD 10,00'), "Totaal prijs", optioneel "Waarvan
  BTW (x%)", OPMERKINGEN, BETALINGSGEGEVENS (USD – Dollar | EUR – Euro | SRD, lege waarde
  "________________"), betaalinstructie, BETALINGSVOORWAARDEN, footer op elke pagina;
  CONCEPT- en GEANNULEERD-watermerk, stempel "BETAALD dd-mm-jjjj". `@page` per papierformaat,
  marges 0,45 in 0,55 in, `print-color-adjust: exact`, slotblok blijft bij elkaar.
- Getrouwheid: met Playwright (Chromium) gerenderd en naast `invoice-template-p1/p2.png`
  vergeleken op 110 dpi (scripts in de scratchpad, `p6a/render.tsx`, `shoot.mjs`): kleuren
  #713A28/#F5F2EC/#D8D2C9 per pixel gelijk, geen haarlijn tussen de kopcellen. Afwijking
  bewust volgens §35.11: de logoband is maximaal 1,9 in (in het sjabloon ~4,5 in), daardoor
  past een factuur met vracht op één pagina. Printproef (`page.pdf`): 8 vrachtregels = 1
  pagina, 20 regels = 2 pagina's met herhaalde kop en footer op beide, alle kostensoorten =
  slotblok samen op pagina 2; A4 = 1 pagina.
- `src/lib/invoice/print.ts` `waitForInvoiceAssets()` (fonts + logo) voor de print-routes.

Totalen (§35.9): `src/lib/invoice/totals.ts` `computeInvoiceTotals(lines, vatRate)` in hele
centen met BigInt (half-up zoals Postgres `round`), vracht = round(gewicht × tarief, 2), BTW
inclusief over niet-vrijgestelde regels (basis ≥ 0), negatief totaal gemarkeerd.
`supabase/tests/pglite/invoice_totals.test.ts`: 5 randgevallen + 300 gegenereerde facturen
(vast zaadje) door de echte triggers als beheerder, ook geweigerde negatieve totalen, plus 40
na `issue_invoice` met een ander BTW-tarief: TS == SQL tot op de cent. Gecontroleerd dat de
test faalt als de afronding half-down is.

Bouwer: `src/lib/admin/invoice-builder.ts` (status, vrachtregels, validatie, `saveDraft`,
`loadDraft`, `deleteDraft`, `loadBuilderOrders`), `invoice-queries.ts`,
`src/components/admin/invoices/*`, routes `admin/facturen/nieuw.tsx` en
`admin/facturen/$id.tsx`; server function `issueInvoiceFn` in
`src/lib/server-fns/invoices.functions.ts` (`requireStaff`, zod, `issue_invoice` met de eigen
client, fouten als data met hint `invoice_dates`), haak `src/server/invoice-notifications.ts`
(`emailed: false` tot P8). PGlite `invoice_builder_contract.test.ts` draait de bibliotheekcode
ongewijzigd als medewerker: opslaan = voorbeeldtotalen, bewerken werkt regels bij (ids blijven,
volgorde), vracht twee keer → 23505 Nederlands, order van andere klant → 22023, na uitgeven
55000 bij opslaan/verwijderen, oude datums → hint `invoice_dates`, concept verwijderen maakt de
vracht vrij, klant krijgt 42501.

Gecontroleerd: `bun run test` 65 bestanden, 806 tests groen (1 skipped); `bunx tsc --noEmit`
schoon; `bun run build` en `VERCEL=1 bun run build` slagen; eslint op de gewijzigde bestanden
schoon. Browser (Playwright, dev-server met `SUPABASE_URL` naar een lokale mock, Supabase in de
browser gestubd; niets naar het live project): orderpagina → "Genereer factuur" → vrachtregel
3,40 → 3,50 lbs (afronding 0,5) × USD 4,50, voorbeeld live bijgewerkt met inklaring, korting
en OPMERKINGEN, "Opslaan als concept" → `/admin/facturen/<id>`, gewicht wijzigen en opnieuw
opslaan (één concept, totaal bijgewerkt), "Genereer factuur" → bevestiging → INV-2026-0013
(`issue_invoice` vanaf de server), toast "Factuur succesvol aangemaakt." + "Er is geen e-mail
verstuurd", document zonder CONCEPT; validatie zonder klant (focus op klant, alle fouten),
datums uit vorig jaar → "Datums bijwerken"; weggaan met wijzigingen vraagt eerst; selectie van
twee orders van één klant → "Genereer factuur (2)", gemengde klanten → uitleg; klantpagina →
bouwer. 390/1024/1440 px zonder horizontale scroll; tabs onder 1024 px. axe: alleen
color-contrast op de footer (zie open punten).

## Niet geverifieerd / open punten na P6/P7 deel A

- De footer gebruikt de voorgeschreven #777777 (§35.11): 4,48:1 op wit, net onder WCAG AA
  4,5:1 (axe meldt het). De footer is `aria-hidden` (herhaling van de bedrijfsnaam); #767676
  zou het oplossen als de eigenaar dat goedvindt. De grijze tracking-regel gebruikt #6B6B6B.
- Printen alleen in Chromium (Playwright `page.pdf`) gecontroleerd; Safari/Firefox (footer
  `position: fixed`, herhaalde tabelkop) niet.
- Opslaan van een concept bestaat uit meerdere PostgREST-verzoeken (kop, verwijderde regels,
  gewijzigde regels, nieuwe regels in één insert); mislukt er een halverwege, dan staat een deel
  in het concept en blijft het formulier staan om opnieuw te proberen.
- Live Supabase niet aangeraakt.

## Bewijs P5 reviewronde (2026-10-07)

23 bevindingen van de P5-review nagelopen. De bewijs-tests van de reviewer
(`review_p5_security.test.ts`, `review_p5_spec.test.ts`) zijn omgezet naar blijvende tests in
`customers_contract.test.ts` en `team_settings_contract.test.ts` (met de omgekeerde verwachting)
en daarna verwijderd. Migratie: dezelfde, nog niet toegepaste
`20261007150000_p5_customers.sql` (geen nieuw bestand; conventies groen):

- `keep_order_after_cancellation_request(_order_id, _customer_message default null)`: zet bij
  het leegmaken van het verzoek een klantzichtbaar bericht op de geschiedenis van de order
  (zelfde status, zoals een nieuw "Actie vereist"-bericht; standaardtekst als staff niets
  invult, max. 2000 tekens). De dialoog "Order behouden" heeft daarvoor een tekstveld,
  vooraf ingevuld.
- `redeem_invitation`: een login die de uitnodiging zelf aanmaakte of bevestigde
  (`app_metadata.invitation_id` = deze uitnodiging, paden a en b) krijgt de profielnaam uit
  het klantdossier (klant) of geen naam (medewerker vult hem zelf in), nooit wat een vreemde
  bij een onbevestigde registratie intypte. Pad b overschrijft ook `user_metadata`
  (`full_name` uit de uitnodiging, telefoon/bedrijf/soort/voorwaarden van de vreemde weg).
- `log_team_login_change`: trekt bij deactiveren alle niet-geaccepteerde uitnodigingen van die
  persoon in (ook klantuitnodigingen: die persoon zag de links), met reden in het auditlog
  ("Ingetrokken: login van … gedeactiveerd"), een interne notitie op elke betrokken
  klantpagina en telt alleen nog niet verlopen uitnodigingen als "open".
- `get_invitation` (zelfde signatuur): een uitnodiging waarvan de uitnodiger de rechten niet
  meer heeft (gedeactiveerd, rol weg buiten de app) komt terug als ingetrokken, dus `/invite`
  zegt dat en pad b verandert niets meer aan een bestaande login voordat
  `redeem_invitation` zou weigeren.
- `invitations_guard`: de limieten 1×/minuut en 5×/Surinaamse dag gelden per e-mailadres
  (alle rijen, ook ingetrokken), ook voor een nieuwe uitnodiging na "Intrekken"; een tweede
  open uitnodiging blijft de unieke index (melding "al uitgenodigd").

Server en UI:

- Klant "Deactiveren"/"Activeren": `setCustomerDisabledInDb` kijkt vooraf in `user_roles`
  (niet `has_role`, dat gebande logins verbergt) of de gekoppelde login bij het team hoort;
  `setCustomerDisabledFn` bant of ontbant dan nooit (ook niet de eigen login), alleen het
  klantdossier verandert, met de melding "… (de)activeert u op de pagina Team"
  (`disableLoginPlan`, unit-test).
- `recoveryTarget`: een teamlogin (ook gedeactiveerd; via `team_members()`, vóór de migratie
  `has_role`) krijgt geen resetlink vanaf een klantpagina, ook niet door een beheerder
  (die maakt hem op `/admin/team`, dat gedeactiveerde leden weigert).
- Eenmalige links (6 dialogen: uitnodigen, opnieuw versturen voor klant en medewerker,
  medewerker uitnodigen, resetlink klant en team): buiten klikken, Escape, de X of "Sluiten"
  vragen eerst "De link is nog niet gekopieerd of gedeeld – Terug naar de link / Toch
  sluiten" zolang de link niet gekopieerd (knop of Ctrl+C) of via WhatsApp gedeeld is
  (`link-guard.ts`, `one-time-link.tsx`). Na sluiten gaat de focus naar de wachttijd-tekst
  van het uitnodigingspaneel; `restoreFocus` slaat een uitgeschakelde knop over.
- Deel-tekst (WhatsApp) noemt het volledige e-mailadres ("U logt in met …"); `/invite`
  zegt dat het volledige adres in het bericht staat en na activeren getoond wordt, de
  succesmelding noemt het adres.
- "Klant uitnodigen": een conflict staat boven de knoppen terwijl het formulier gevuld blijft
  (verdwijnt bij wijzigen van e-mail of code), zoals bij "Medewerker uitnodigen".
- "Code wijzigen": live controle zoals bij klant toevoegen ("GR00042 is al toegewezen aan
  Maria Pinas", ongeldige notatie, "Dit is al de code van deze klant"); de knop is
  uitgeschakeld met uitleg als de code vastligt.
- Instellingen: elk formulier meldt niet-opgeslagen wijzigingen (badge "Niet opgeslagen",
  Opslaan-knop gevuld), een balk onderaan noemt de secties met links, en weggaan via de app
  (TanStack `useBlocker`) of de browser (beforeunload) vraagt eerst ("Blijven en opslaan" /
  "Wijzigingen weggooien"). Bankrekening: uitleg welke velden nodig zijn, "Er was niets
  gewijzigd" zonder verzoek, en bevestiging voordat een complete rekening onvolledig wordt
  (`bankAccountChange`, unit-test). Tarieven-intro gecorrigeerd.
- Dashboard: "Open taken" bovenaan; medewerkers zien de setup-lijst als één regel ("Een
  beheerder moet nog N instellingen invullen"); kan een bron niet laden, dan een foutmelding
  met "Opnieuw proberen" en de waarschuwing dat de lijst onvolledig kan zijn.
- Teksten: geen bestandsnamen of docs-verwijzingen meer voor medewerkers (servicesleutel:
  "vraag de beheerder; zie Systeemstatus"), "Medewerkers", "de registratiepagina",
  "(uzelf)", "Link laatst gemaakt" (alleen bij open/verlopen uitnodigingen, "vandaag 2 van 5
  keer" vanaf de tweede keer).
- Klantenlijst: e-mailadressen breken na de "@" en alleen in nood midden in een woord;
  bredere contactkolom. `/admin/orders/nieuw?customer=` van een gedeactiveerde of onbekende
  klant zegt waarom er geen klant gekozen is.
- Teampagina: "Deactiveren" toont vooraf welke uitnodigingen vervallen (klanten met link naar
  hun pagina, "(al verlopen)", aantal medewerker-uitnodigingen).

Tests en controles:

- `bun run test`: 58 bestanden, 743 tests groen (1 skipped, de bestaande). Nieuw/aangepast:
  PGlite `customers_contract.test.ts` (team-login bij Deactiveren: eigen beheerdersdossier,
  staff via pad c, gebande staff; uitnodiger gedeactiveerd → "revoked", geen `updateUserById`;
  limiet per adres met Intrekken + Uitnodigen; profielnaam pad b voor klant en medewerker;
  klantbericht bij "Order behouden" + te lang; resetlink voor teamlogin ook na ban; het
  SPEC §5-voorbeeld John Doe GR00017), `team_settings_contract.test.ts` (notities, auditreden,
  verlopen niet geteld, `pendingInvitationsBy`), `m1_identity.test.ts` (nieuwe uitnodiging
  binnen een minuut na intrekken geweigerd), unit-tests `customer-actions`
  (`disableLoginPlan`), `order-actions` (bericht), `invitations` (e-mail in deeltekst,
  `sendsToday`), `settings` (`bankAccountChange`), `focus-return`, `server/invitations`
  (pad b `user_metadata`).
- `bunx tsc --noEmit` schoon; eslint en prettier schoon op alle gewijzigde bestanden (lijst
  `p5r-changed.txt` in de scratchpad); `bun run build` en `VERCEL=1 bun run build` slagen.
- Browsercontrole (Playwright tegen `vite dev`, Supabase gestubd zoals in deel A/B, script
  `review-5/fixes.mjs`, stub uitgebreid met het klantbericht, de uitnodiger-controle, de
  notities, `user_metadata` en de minuutlimiet per adres) op 320, 390, 1280 en 1440 px, als
  beheerder en medewerker: buiten klikken/Escape houdt de linkdialoog open met de vraag, na
  kopiëren sluit hij en staat de focus op de wachttijd-tekst; conflict met gevuld formulier;
  deactiveren van het dossier van Kenneth (staff) → geen `auth/v1/admin`-aanroep, melding
  "… pagina Team"; resetlink daarvoor geweigerd; "Order behouden" met bericht → historieregel;
  instellingen: badge + balk, navigeren naar Dashboard → blokkeerdialoog, "Blijven" houdt de
  wijziging, "Weggooien" navigeert; lege EUR-opslag → "Er was niets gewijzigd", geen verzoek;
  dashboard-volgorde en foutstatus (500 op bankrekeningen); teamdialoog toont "Ellen Expired
  (GR00033) (al verlopen)" en na deactiveren de notitie; `/invite` succesmelding "U logt
  voortaan in met hugo@example.com". axe 0 overtredingen (ook met de vraag, de
  behouden-dialoog en de teamdialoog open), geen horizontale scroll, geen consolefouten
  (behalve de bewust veroorzaakte 500's).

## Niet geverifieerd / open punten na P5 reviewronde

- Live niet geverifieerd: dat GoTrue's admin-update `user_metadata` samenvoegt en een sleutel
  met `null` verwijdert (zo gedocumenteerd en in de stub nagebootst).
- Twee beheerders die elkaar op precies hetzelfde moment deactiveren, kunnen samen alle
  beheerders buitensluiten (de ban gebeurt in Auth vóór de databasecontrole); herstel via het
  Supabase-dashboard. Niet opgelost (zeldzaam, vereist twee beheerders die tegelijk handelen).
- De limiet per adres telt `send_count` van rijen die vandaag zijn verstuurd; de knop
  "Opnieuw versturen" rekent nog per rij en kan dus aan staan terwijl de database weigert (de
  melding legt het dan uit).
- Het US-adres (dialoog) meldt geen niet-opgeslagen wijzigingen: het is een modale dialoog.

## Bewijs P5 deel B (2026-10-07)

Teampagina, instellingen en het volledige dashboard. Migratie: dezelfde, nog niet toegepaste
`supabase/migrations/20261007150000_p5_customers.sql` kreeg een vierde deel (geen nieuw bestand;
de eigenaar past het geheel toe, de GitHub Action ververst `types.ts`):

- 4. Team:
  - `public.has_role()` en `public.is_staff()` (zelfde signatuur): een login met
    `auth.users.banned_until` in de toekomst heeft geen rol. Dus deactiveren werkt direct, ook
    voor een toegangstoken dat nog geldig is, en `redeem_invitation` weigert uitnodigingen van
    een gedeactiveerde beheerder ("niet meer geldig").
  - `public.set_user_role` (zelfde signatuur, zelfde meldingen): weigert ook dat de enige
    beheerder die nog kan inloggen zichzelf de beheerdersrol afneemt ("De laatste actieve
    beheerder kan niet worden verwijderd …", 55000).
  - `public.team_members()`: staff en beheerders (guard `is_staff`, 42501) zien iedereen met
    een rol, met naam, e-mailadres, rollen, gedeactiveerd ja/nee, laatste login en sinds wanneer.
  - `public.log_team_login_change(_user_id, _blocked, _reason)`: alleen beheerders, reden
    verplicht, alleen teamleden, nooit uzelf deactiveren; schrijft een auditregel
    (`table_name = 'team_login'`, reden) en trekt bij deactiveren de open uitnodigingen van die
    persoon in. Execute alleen voor `authenticated`.
  - Conventies (`conventions.test.ts`) groen. Tot de migratie live staat: de teampagina valt
    terug op `user_roles` + `profiles` (beheerders zien het team zonder e-mailadressen en
    deactiveringsstatus, medewerkers alleen zichzelf, met een melding), deactiveren bant de
    login wel maar schrijft geen auditregel (toast zegt dat), en een nog geldig token houdt tot
    een uur zijn rechten.
- Server (alle fouten als data):
  - `lib/server-fns/team.functions.ts` (beheerder):
    - `inviteStaffFn`: de staff-uitnodiging met de eigen sessie van de beheerder. Alleen de
      SHA-256 gaat naar de database, het ruwe token alleen in de link op het scherm.
      Conflicten: al teamlid, al uitgenodigd, open klantuitnodiging, of het adres van een
      klantdossier. P8-haak `onInvitationSent`.
    - `setTeamLoginBlockedFn`: eerst controleren tegen `team_members()` (teamlid, niet uzelf,
      niet twee keer), dan ban/unban via `auth.admin.updateUserById`, dan
      `log_team_login_change`.
    - `createTeamRecoveryLinkFn`: alleen voor teamleden die niet gedeactiveerd zijn.
  - `lib/server-fns/system.functions.ts` (`systemStatusFn`, beheerder): `configStatus()` uit
    `src/server/system-status.ts` geeft alleen booleans, plus de laatste `job_runs`-regel van
    `payment_reminders` via de eigen client.
  - Rollen wijzigen gaat zonder server function: `set_user_role` met de eigen client
    (`changeTeamRole`: eerst de nieuwe rol, dan de oude weg; weigert de database dat, dan
    wordt de toegevoegde rol teruggedraaid).
  - Gedeelde helpers:
    - `lib/server-fns/helpers.ts` (alleen wat ook in de browser mag).
    - `src/server/fn-helpers.ts` (`serviceFailure`, `screenBase`, dynamisch geladen).
      `customers.functions.ts` gebruikt ze nu ook.
- Instellingen: alle schrijfacties met de eigen client van de beheerder (RLS: alleen
  beheerders, ook te zien bij medewerkers die het via de API proberen: `42501` "Alleen een
  beheerder …"). Alleen gewijzigde kolommen, `audit_row`-triggers loggen ze.
  `lib/admin/settings.ts` bevat:
  - de secties en hun veldregels;
  - `paymentTermsWarnings`;
  - `formatInvoiceNumber`, zelfde formaat als `issue_invoice`;
  - `billableWeight`: altijd naar boven afronden, in honderdsten;
  - `incompleteBankCurrencies`;
  - controle op placeholders in de US-adressen.
- Tests: `bun run test` 58 bestanden, 730 groen (1 skipped, de bestaande). Nieuw:
  - PGlite `team_settings_contract.test.ts` (20). De echte code van de app (`lib/admin/team.ts`,
    `lib/admin/settings.ts`) tegen de migraties, met een supabase-js-nabootsing die rijen
    teruggeeft zoals PostgREST (datums als tekst, numeric als getal). Bewezen:
    - `team_members()` voor staff en beheerder, maar niet voor klant of anon;
    - een gebande login heeft direct geen rechten en is weer staff na unban;
    - de uitnodiging van een gedeactiveerde beheerder werkt niet meer;
    - laatste actieve beheerder;
    - `log_team_login_change` (alle weigeringen, audit, ingetrokken uitnodigingen);
    - `changeTeamRole` heen en terug, en bij weigering niets half gedaan;
    - `inviteStaff` (alleen de hash, alle conflicten, staff mag niet);
    - de seed van company_settings valideert ongewijzigd;
    - opslaan alleen door beheerders, alleen gewijzigde kolommen in `audit_log`;
    - registreren uit → geen klantdossier maar een taak;
    - bankrekening, US-adres (klant ziet alleen actieve), zeevracht aan met tarief (klant ziet
      hem), factuurteller (staff ziet hem niet), volgende klantcode (alleen omhoog, peek volgt).
  - `lib/admin/{settings,team,system-status}.test.ts`, `server/system-status.test.ts`.
  - Uitgebreid: `dashboard`, `keys`, `nav`.

  Verder:
  - `bunx tsc --noEmit` schoon.
  - `bun run build` en `VERCEL=1 bun run build` slagen.
  - eslint en prettier schoon op alle gewijzigde bestanden (lijst in de scratchpad
    `p5b-changed.txt`).
- Browsercontrole (Playwright tegen `vite dev`, Supabase volledig gestubd zoals in deel A,
  servicesleutel `sb_secret_stub` alleen voor de lokale mock; scripts in de scratchpad `p5b/`):
  - `/admin`, `/admin/team` en `/admin/instellingen` (ook met `#bankrekeningen-title`) als
    beheerder en als medewerker, op 320, 390, 768, 1024, 1280 en 1440 px: geen horizontale
    scroll, axe 0 overtredingen, geen consolefouten. Gevonden en opgelost: links in "Recente
    activiteit" alleen door kleur te herkennen (axe `link-in-text-block`, nu onderstreept),
    te lage links in de checklist en KPI's (nu min. 32 px), bankrekeningen als smalle
    label/waarde-rijen (nu onder elkaar), en een factuurteller die "volgende factuur …" toonde
    naast "de nummering ligt vast".
  - Doorlopen als beheerder:
    - Facturen: termijn 14 en opslag 12,5 → twee live waarschuwingen, voorbeeld "GR-2026-0001",
      `PATCH company_settings` met alleen die drie kolommen.
    - Lege bedrijfsnaam + fout e-mailadres → twee fouten, focus op de naam, geen verzoek.
    - Ongewijzigd opslaan → "Er was niets gewijzigd".
    - BTW-uitsplitsing zonder tarief → fout op het tarief.
    - Registreren uit → `PATCH {public_signup_enabled:false}`.
    - EUR-rekening → `PATCH company_bank_accounts`, badge "Compleet".
    - US-adres: leeg → 5 fouten met focus; `{NAAM}` → "Onbekende code"; zonder `{GR_CODE}`
      een waarschuwing; live voorbeeld "Énéas … GR00017"; `POST warehouse_addresses`;
      uitschakelen → `PATCH {is_active:false}`.
    - Luchtvracht 4,50 / min 1 / 0,5 → "2,30 lbs wordt 2,50 lbs × USD 4,50 = USD 11,25";
      ongeldig tarief → fout met focus.
    - Factuurteller 41 → `set_invoice_counter` → "INV-2026-0042", en vergrendeld als het jaar
      al een factuur heeft.
    - Volgende klantcode "gr 50" → de databasemelding inline; "GR00500" → opgeslagen.
    - Medewerker uitnodigen: leeg → fout met focus; conflicten teamlid / klantadres (met
      "Klant openen") / al uitgenodigd; nieuw als beheerder → link één keer, token ↔ hash
      klopt, geen hash op het scherm, WhatsApp met "Beste Nina", "geen e-mail verstuurd".
    - Rol Kenneth → beheerder → medewerker (2 resp. 3 RPC's); eigen rij zonder "Deactiveren".
    - Deactiveren zonder reden → fout; met reden → ban `876000h`, `log_team_login_change`,
      "1 open uitnodiging ingetrokken", badge "Gedeactiveerd"; activeren → `none`.
    - Resetlink voor Kenneth.
    - Staff-uitnodiging opnieuw versturen (nieuwe hash, wachttijd) en intrekken.
    - Dashboard: "Naar instellingen" scrolt naar en focust de bankrekeningen; "Klant openen"
      vanuit een taak.
  - Als medewerker: geen invoervelden of knoppen op instellingen en team, geen Systeemstatus.
  - Zonder `team_members()`: de terugvalmelding.
  - De flows van deel A (uitnodigen, opnieuw versturen, deactiveren, resetlink, "Order
    behouden", inwisselen a/c/staff) en de paginaronde van deel A draaiden opnieuw groen na
    het verplaatsen van de servergedeelde helpers.

## Niet geverifieerd / open punten na P5 deel B

- Niets van P5-B is tegen het live Supabase-project gedraaid. Niet live bevestigd: dat
  `auth.users.banned_until` na `ban_duration` door GoTrue zo wordt gezet dat `has_role`/
  `is_staff` het direct zien (in PGlite nagebootst), en `team_members()` met de echte
  `auth.users.email` (varchar) en `last_sign_in_at`.
- Migratie `20261007150000_p5_customers.sql` staat nog niet live (zie deel A). Tot dan: de
  teampagina toont de terugvallijst, deactiveren schrijft geen auditregel en een nog geldig
  token van een gedeactiveerd teamlid werkt tot het verloopt (max. 1 uur).
- Een teamlid verwijderen (alle rollen weg) zit niet in de app: deactiveren houdt de rol
  bewaard, zodat de geschiedenis blijft kloppen. Wie het echt wil, kan het met SQL doen.
- Betalingsherinneringen (P8): de instellingen bestaan en Systeemstatus toont de laatste
  ronde uit `job_runs`, maar er draait nog geen job.
- Bij het wijzigen van de voorwaardentekst wordt niet afgedwongen dat de versie omhooggaat;
  de hint vraagt erom.
- De factuurteller toont alleen het huidige jaar (Suriname-tijd).

## Bewijs P5 deel A (2026-10-07)

Klantbeheer, uitnodigingen en de twee carry-overs uit P4. Nieuwe migratie (eigenaar moet hem
toepassen; de GitHub Action ververst `types.ts`):

- `supabase/migrations/20261007150000_p5_customers.sql`:
  1. `public.keep_order_after_cancellation_request(_order_id)`: alleen staff (42501), vergrendelt
     de order, weigert een geannuleerde order en een order zonder verzoek of open taak (55000),
     maakt `cancellation_requested_at` leeg (met `app.audit_reason` "Annuleringsverzoek
     afgehandeld: order behouden") en sluit de open `order_cancellation_request`-taak, in één
     transactie. Execute alleen voor `authenticated`. "Order behouden" op `/admin/orders/$id`
     gebruikt hem (`keepOrderAfterCancellation` in `lib/admin/order-actions.ts`); zolang de
     migratie niet live staat (PostgREST `PGRST202`/`42883`) sluit de knop alleen de taak, zoals
     in P4.
  2. `private.handle_new_user()`: een bevestigde login zonder klantdossier geeft altijd een
     staff-taak: open staff-uitnodiging voor het adres → `signup_email_conflict` ("… open
     uitnodiging als medewerker …"); bekend klantadres of open klantuitnodiging →
     `signup_email_conflict` (zoals voorheen, nu ook als registreren uit staat); registreren uit
     → `signup_customer_failed` ("… terwijl registreren uitstaat …").
  3. `public.redeem_invitation` (zelfde signatuur) sluit die taken voor het adres (en de
     conflicttaak van de klant) bij het inwisselen.
  Conventies (`conventions.test.ts`) groen; PGlite-tests in `customers_contract.test.ts` en
  drie aangepaste verwachtingen in `m1_identity.test.ts` (staff-uitnodiging en registreren-uit
  geven nu een taak; pad b sluit twee taken).
- Server (alle fouten als data, `requireStaff`/`requireAdmin`):
  `lib/server-fns/customers.functions.ts` (`inviteCustomerFn`, `resendInvitationFn`,
  `setCustomerDisabledFn` (beheerder; status met de eigen client, daarna ban/unban via
  `auth.admin.updateUserById`, `ban_duration` `876000h`/`none`), `createRecoveryLinkFn`),
  `lib/server-fns/invitations.functions.ts` (`getInvitationFn`, `redeemInvitationFn`,
  `redeemInvitationAsUserFn`). Service role alleen in `src/server/{admin-client,auth-admin,
  invitations}.ts`: `auth.admin.*` en het opzoeken/inwisselen van een uitnodiging nadat het
  token (43 tekens base64url) is gecontroleerd en met SHA-256 gehasht. Uitnodigen en opnieuw
  versturen schrijven met de eigen sessie van staff (RLS); de hash verschijnt nooit in een
  antwoord, het ruwe token alleen in de link. Pad a/b: login aanmaken of bevestigen +
  wachtwoord, `redeem_invitation`, voorwaarden vastleggen; mislukt het koppelen, dan wordt een
  net aangemaakte login weer verwijderd. Pad c: eerst inloggen, de user-id komt uit het
  geverifieerde token. Links: `getAppUrl()`; alleen voor links op het scherm valt
  `screenLinkBase()` zonder `APP_URL` terug op de origin van de browser (de dialoog zegt dat).
  E-mail: haken `onInvitationSent`/`onInvitationRedeemed` in
  `server/invitation-notifications.ts` (P8), nu `emailed: false`; de dialogen zeggen dat er
  geen e-mail is verstuurd.
- Tests: `bun run test` 53 bestanden, 682 tests groen (1 skipped, al eerder);
  nieuw `customers_contract.test.ts` (21, PGlite met een supabase-js-nabootsing: echte RLS,
  guards, triggers en audit), `server/invitations.test.ts` (21, gemockte service-client voor
  paden a/b/c, staff, verlopen/ingetrokken/gebruikt, rollback), `server/auth-admin.test.ts`,
  `server/admin-client.test.ts`, `lib/admin/{invitations,customers,customer-actions}.test.ts`,
  `lib/auth/invite-schemas.test.ts`, uitbreidingen in `order-actions`, `keys` en `nav`.
  `bunx tsc --noEmit` schoon; `bun run build` en `VERCEL=1 bun run build` slagen; eslint en
  prettier schoon op alle gewijzigde bestanden.
- Browsercontrole (Playwright tegen `vite dev`, Supabase volledig gestubd: browserverkeer via
  routes, server functions via een lokale mock op `SUPABASE_URL=http://127.0.0.1:54329` met
  `SUPABASE_SERVICE_ROLE_KEY=sb_secret_stub`, inclusief `auth/v1/admin/*`; niets naar het
  live project): `/admin/klanten` (zoeken "gr 17", telefoon, filters, leeg), klantpagina's
  (Maria met login en facturen, Johan zakelijk zonder login, Hugo uitgenodigd, Ellen verlopen,
  Carol gedeactiveerd, onbekend en ongeldig id) en `/invite` (open, pad c, verlopen, gebruikt,
  ongeldig, misvormd, staff) op 320/390/768/1024/1280/1440 px: geen horizontale scroll, axe 0
  overtredingen, geen consolefouten. Doorlopen: klant toevoegen (lege verzending toont alle
  fouten, "GR00042 is al toegewezen aan Maria Pinas", opslaan → klantpagina), uitnodigen
  (link één keer, token ↔ hash klopt, kopiëren, WhatsApp-tekst, conflicten login/andere
  code/gedeactiveerd/al uitgenodigd), opnieuw versturen (nieuwe hash, knop daarna geblokkeerd
  "kan over 59 seconden") en intrekken, gegevens wijzigen als staff (alleen gewijzigde velden,
  e-mail alleen-lezen), code wijzigen als beheerder (reden verplicht; geschiedenis "Klantcode
  gewijzigd: GR00031 → GR00018 · reden: …"), Maria's code vast, deactiveren/activeren (ban
  `876000h` → `none`, notitie, banner met reden), resetlink, "Order behouden" (RPC, verzoek
  leeg, taak gesloten), inwisselen pad a (Ellen, na verlenging) → `/portal`, pad c (Carl: fout
  wachtwoord → "Onjuist e-mailadres of wachtwoord.", daarna gekoppeld) → `/portal`, staff (Kim,
  naam in het profiel) → `/admin`, dezelfde link daarna "Deze uitnodiging is al gebruikt".
  Gevonden en opgelost: `<dl>` met een losse regel op `/invite` (axe), een gedeactiveerde klant
  met login gaf het conflict "heeft al een login" (nu "gedeactiveerd", test toegevoegd), de
  wachttijd na opnieuw versturen begon bij het laden van de pagina (toonde 62 s), "Volledige
  naam" toonde bedrijf + naam.

## Niet geverifieerd / open punten na P5 deel A

- Niets van P5-A is tegen het live Supabase-project gedraaid. Niet live bevestigd:
  `auth.admin.createUser`/`updateUserById` (`ban_duration`)/`generateLink({ type: "recovery" })`
  met de nieuwe `sb_secret_`-sleutel, de foutcode van GoTrue voor een bestaand adres
  (`email_exists`) en voor een gebande login bij inloggen (`user_banned`), en de directe
  `insert` in `customers` zonder `customer_number` door staff (trigger nummert; in PGlite getest).
- Migratie `20261007150000_p5_customers.sql` staat nog niet live; tot dan sluit "Order behouden"
  alleen de taak (het portaal blijft het verzoek tonen) en geeft `handle_new_user` bij
  registreren-uit en open staff-uitnodigingen nog geen taak.
- Resetlinks: geldigheid volgt de Auth-instelling (standaard 1 uur); `/auth/confirm` met
  `token_hash` + `type=recovery` bestaat sinds P2b, live niet bevestigd voor links uit
  `generateLink`.
- E-mail (uitnodiging, welkom) is P8: de haken bestaan, er wordt niets verstuurd.
- Staff zien geen `audit_log` (alleen beheerders); hun geschiedenis is afgeleid uit de rijen en
  mist dus wijzigingen van contactgegevens en eerdere codes.
- De klantenlijst laadt alle klanten, orders per klant en openstaande facturen in de browser;
  prima voor het huidige volume (honderden klanten).
- ~~Deel B (P5): teampagina (staff uitnodigen/deactiveren), instellingen en dashboard-uitbreiding.~~ Gedaan in P5 deel B.

## Bewijs P4 reviewronde (2026-10-07)

Zesentwintig bevindingen van de P4-review nagelopen; alle echte bevindingen opgelost (één
deels, zie onder). Nieuwe migratie (eigenaar moet hem toepassen en `types.ts` verversen; de
signaturen van bestaande RPC's blijven gelijk, dus de app werkt ook vóór het toepassen, alleen
zonder de nieuwe databasebewaking):

- `supabase/migrations/20261007120000_p4_order_guards.sql`:
  1. `private.apply_order_status` (vervangt die van migratie 2): een afgeronde status
     ("Afgehaald", "Bezorgd") voor orders van meer dan één klant wordt geweigerd (22023, hint
     `handover_one_customer`): één ophalernaam hoort bij de pakketten van één klant (voorheen
     zag klant A de ophaler van klant B in het portaal). Orders die de status al hebben tellen
     niet mee. Nieuw bericht bij een order die al in "Actie vereist" staat: een eigen
     historieregel (van = naar) met het bericht, de klant leest het nieuwste bericht; hetzelfde
     bericht nogmaals verandert niets.
  2. `public.pickup_override` (zelfde signatuur): vergrendelt de selectie, controleert "één
     klant", bepaalt zelf welke orders echt een openstaand saldo hebben
     (`private.orders_with_open_balance`) en zet de reden alleen op die orders in `audit_log`;
     de rest wordt gewoon afgegeven, in dezelfde transactie (een verouderde lijst in de browser
     kan de override dus niet verbreden).
  3. Triggers `orders_shipment_service_type` (een order in een zending kan niet van
     verzendwijze wisselen, ook niet door de klant terwijl hij nog "aangemeld" is: 55000; een
     order in een zending van een andere verzendwijze zetten: 22023) en
     `shipments_service_type_guard` (verzendwijze van een zending met orders blijft vast:
     55000). Hiermee is de carry-over "zending en verzendwijze" opgelost.
  Conventies (`conventions.test.ts`) blijven groen; nieuwe functies in `private`, SECURITY
  DEFINER, `search_path = ''`, execute ingetrokken. De idempotentietest van migratie 3 speelt
  nu migratie 3 en alle latere opnieuw af (latere migraties vervangen functies van migratie 3).
- App: statusdialoog biedt bij orders van meerdere klanten geen afgeronde status aan (uitleg
  "Afgeven gaat per klant"), ook niet bij "Status voor hele zending wijzigen"; titel "Afgeven
  aan klant" bij een afgeronde status, de blokkade "Nog niet betaald" + reden direct onder de
  ophaler, knoppen blijven onderin zichtbaar (sticky); orders die nog ontvangen kunnen worden
  maar dat niet zijn, blijven staan als de nieuwe status voorbij het US-magazijn ligt (melding
  in de dialoog en in de toast; bij één order geblokkeerd met "Ontvang eerst …"); "Gewicht
  invullen/corrigeren" voor elke open order voorbij het magazijn (directe update van
  `measured_weight_lbs` met de eigen client, auditregel); "Nieuw bericht aan klant" bij
  "Actie vereist" (orderpagina) en de huidige "Actie vereist"-status kiesbaar; bij één order
  staat de volgende status (standaard van de volgende fase) al gekozen; "Klant e-mailen" zegt
  "E-mail is nog niet geconfigureerd: de klant krijgt nu nog geen e-mail" en de toast meldt dat
  er geen e-mail is verstuurd (`lib/admin/email.ts`, P8 vervangt dit door de echte
  providerstatus); de P8-haak krijgt per e-mail ook de `historyIds` (idempotentiesleutel).
- `requireStaff`/`requireAdmin` overschrijven `supabase`, `userId` en `claims` van
  `requireSupabaseAuth` met `undefined` (ook in de types): een handler die de rolcontrole
  vergeet, compileert niet meer (bewezen met het scratch-bestand van de review) en
  `middleware.test.ts` controleert dat elke handler met deze middleware begint met
  `if (!access.ok) return denied(access)`.
- `/admin/orders`: scanveld krijgt bij binnenkomst de focus (alleen met muis/scanner, niet op
  telefoons), selecteert bij focus de vorige scan (ook bij klikken), na "Ontvangen" vanuit het
  zoekresultaat wordt het veld leeg en krijgt het de focus terug (3 scans achter elkaar zonder
  klikken); het zoekresultaat staat direct onder het zoekveld (390 px: knop "Ontvangen" op
  y=456 i.p.v. 835), toont de status, en biedt "Ontvangen"/"Gewicht corrigeren", "Afgeven aan
  klant", "Status wijzigen" en "Order openen" (status wijzigen na een scan: 3 klikken i.p.v. 6),
  met tekst per fase (geannuleerd: waarschuwing; afgerond); selectiebalk blijft onderin in
  beeld (ook op de zendingpagina); trackingnummers vanaf 1440 px op één regel (tussen 1280 en
  1440 px mogen lange nummers nog afbreken, anders past de tabel niet); als de facturen niet
  laden staat er "Onbekend" (nooit "Geen factuur") en zijn de filters "Openstaande factuur" /
  "Annulering aangevraagd" uitgeschakeld; kaarten op telefoons in twee kolommen (lijst 390 px
  10.877 px i.p.v. 14.316 px hoog), selectievakjes 44 px aantikbaar.
- Alle dialogen (`components/ui/dialog.tsx`, `alert-dialog.tsx`) geven de focus terug aan wat
  hem had (bij een menu-item: de menuknop; is dat weg: de paginatitel), `lib/focus-return.ts`.
- Orderpagina: banner "Klaar voor afhalen, eerst betalen" rood (oranje zonder
  `pay_before_pickup`) bij een openstaand saldo; "afgehandeld door Maria Staff: order
  behouden." in één zin; zendingtegel "Klanten". `/admin/orders/nieuw`: teksten voor staff
  ("Gewicht volgens de klant", "Opmerking (zichtbaar voor klant)", soort order over de klant),
  "Gemeten gewicht" direct onder tracking/vervoerder. Portaal: wijzigformulier toont de
  verzendwijze alleen-lezen zodra de order in een zending zit. Dashboard: tegels voor elke fase
  (ook "In het US-magazijn", "Aangekomen in Suriname", "Ingeklaard"), open taken oudste eerst
  met "Alle N open taken tonen".
- `bun run test`: 45 testbestanden, 586 tests groen (1 skipped, de bestaande tijdafhankelijke
  test). Reviewtests verplaatst naar `admin_contract.test.ts` ("P4 review guards": afgeven per
  klant, override alleen op onbetaalde orders, nieuw bericht bij "Actie vereist", gewicht na
  het magazijn) en `shipments_contract.test.ts` (verzendwijze in een zending, ook door de
  klant); `review_p4_*.test.ts` verwijderd. Nieuw/uitgebreid: `lib/focus-return.test.ts`,
  `lib/admin/statuses.test.ts` (`mustReceiveFirst`, `canSetWeightDirectly`, `receiveMode`,
  `weightAction`, `suggestedNextStatus`), `orders.test.ts` (facturen onbekend),
  `order-actions.test.ts` (historyIds), `middleware.test.ts` (handlers). `bunx tsc --noEmit`
  schoon; eslint + prettier op alle gewijzigde bestanden 0 fouten, 0 waarschuwingen; `bun run
  build` en `VERCEL=1 bun run build` slagen.
- Browsercontrole (Playwright, Supabase volledig gestubd zoals in deel A/B, server functions
  tegen de lokale nep-Supabase; scripts van de review in de scratchpad `review-4/`, de stub
  nagebootst op de nieuwe migratie): `flow.mjs` (scan, status, afgeven, actie vereist,
  annulering, B2B), `focus.mjs`/`focus2.mjs` (focus na Escape/opslaan terug op de knop, de
  menuknop of het scanveld), `bulk2.mjs` (selectiebalk in beeld op 1440 en 390), `mob.mjs`,
  `measure2.mjs`, `dash.mjs`, `cancelscan.mjs`, `states.mjs`, plus `fixcheck.mjs` (hele zending
  zonder "Afgehaald" en met de niet-ontvangen order buiten de RPC-aanroep, afgeven bij 4 klanten
  niet aangeboden, nieuw bericht, gewicht invullen → `PATCH orders {measured_weight_lbs}`,
  afgeefdialoog op 390 px, nieuw-formulier, alle taken). `pages.mjs` op 1440, 1280, 390 en
  320 px over 25 pagina's: geen horizontale scroll, axe 0 overtredingen, geen consolefouten.

Niet opgelost / bewust anders:

- Trackingkolom tussen 1280 en 1440 px: lange nummers (> ±15 tekens) breken nog af; op één
  regel zou de tabel op 1280 px niet meer passen (vanaf 1440 px nooit).
- "Toch afgeven" schrijft de reden nog steeds alleen in `audit_log` (alleen beheerders lezen
  die); de staff-historie toont hem niet (P9).

## Bewijs P4 deel B (2026-10-07)

- `bun run test`: 44 testbestanden, 573 tests groen (1 skipped, de bestaande tijdafhankelijke
  test rond middernacht Paramaribo); nieuw: `lib/admin/shipments.test.ts` (15),
  `lib/admin/status-config.test.ts` (9), `lib/admin/keys.test.ts` (2), uitgebreid
  `lib/nav.test.ts` (adminnavigatie), en PGlite `supabase/tests/pglite/shipments_contract.test.ts`
  (18 tests). `bunx tsc --noEmit` schoon; eslint (incl. prettier) op alle gewijzigde en nieuwe
  bestanden: 0 fouten, 0 waarschuwingen; `bun run build` en `VERCEL=1 bun run build` slagen
  (`.vercel/output` aanwezig). Geen nieuwe migratie: alles past binnen de bestaande RLS en grants.
- PGlite-contract (`shipments_contract`): de code van de app (`lib/admin/shipments.ts`,
  `lib/admin/status-config.ts`, `changeOrderStatus` uit `order-actions.ts`) tegen de echte
  migraties. Bewezen: staff maken een zending met de kolommen van het formulier (tijden als
  Suriname-tijd), zendingnummer uniek ongeacht hoofdletters (23505 met eigen melding), aankomst
  vóór vertrek ook door de database geweigerd; staff wijzigen, een klant kan niet aanmaken,
  wijzigen of verwijderen; orders toevoegen raakt alleen orders van de verzendwijze van de
  zending, de klant ziet daarna de zending en het bericht; een order verhuist tussen zendingen
  (auditregel met wie); een klant kan geen order in of uit een zending zetten (42501);
  kandidaten en samenvatting kloppen met de database; "Status voor hele zending wijzigen" is één
  `change_order_status` voor de lopende orders, een afgehaalde order houdt zijn afhaalgegevens,
  één geplande e-mail per klant; de "Standaard"-status per fase is die van de database (ook een
  nieuwe "Aangemeld"-status die vooraan gesorteerd wordt: daar starten nieuwe orders); een
  beheerder voegt een status toe (actief, eindstatus bij afgerond, audit), wijzigt naam,
  omschrijving, volgorde en vlaggen (code en fase blijven); staff en klanten kunnen niets
  toevoegen, wijzigen of deactiveren en niemand verwijdert; deactiveren: orders houden de status,
  hij wordt niet meer aangeboden en `change_order_status` weigert hem; de laatste actieve
  "Aangemeld" geeft 55000 zoals `deactivationImpact` voorspelt; zonder actieve
  US-magazijnstatus stopt ontvangen (de waarschuwing op de pagina); een verborgen status: de
  klant leest status noch historieregel en er gaat geen e-mail uit.
- Browsercontrole (Playwright tegen de dev-server, zelfde opzet als deel A: Supabase in de
  browser volledig gestubd, server functions tegen een lokale nep-Supabase, niets naar het live
  project; scripts in de scratchpad `p4b/`). Als medewerker: `/admin`, `/admin/zendingen`
  (+ zoeken op AWB, zeevracht, alleen lopend, geen resultaat), drie zendingpagina's (lopend met
  orders, leeg, afgerond), onbekende id en `/admin/zendingen/list`, `/admin/statussen`,
  `/admin/orders`, orderpagina's met en zonder zending en `/admin/orders/list`; als beheerder
  `/admin/statussen`, zendingenlijst en -pagina; op 320, 390, 768, 1024, 1280 en 1440 px: geen
  horizontale scroll, axe 0 overtredingen, geen consolefouten; alle tabellen gemeten op 1280 px:
  even breed als hun kaart (geen scroll).
- Interacties (1440, 390 en 320 px): zending aanmaken leeg/te lang/aankomst vóór vertrek → drie
  fouten tegelijk, focus op het nummer, geen verzoek; "air-2026-014" → "Er bestaat al een zending
  met nummer …" inline en als toast; aangemaakt → `POST shipments` met de zeven kolommen
  (nummer getrimd, vertrek als UTC van Suriname-tijd) en door naar de zendingpagina. Orders
  toevoegen: scannen "1z999aa1-0123456784" vinkt ORD-2026-00001 aan, zeevracht/afgehaald/onbekend
  geven elk hun reden, aanvinken incl. een order uit een andere zending → één
  `PATCH orders?id=in.(…)&service_type=eq.air` met alleen `shipment_id`, toast "3 orders
  toegevoegd … 1 order verhuist uit een andere zending". Uit zending halen (selectie) →
  `PATCH orders?…&shipment_id=eq.<zending>` met `shipment_id: null`, status ongewijzigd. Hele
  zending → titel "Status voor hele zending AIR-2026-015", "Klant e-mailen" aan → de server
  function riep `rpc/is_staff` en één `rpc/change_order_status` met beide lopende orders en het
  bericht. Gegevens wijzigen: verzendwijze uitgeschakeld met uitleg, `PATCH shipments`. Vanuit
  het orderoverzicht: zonder keuze "Kies een zending" met focus, de afgeronde zending staat niet
  in de lijst, zeevrachtzending kiezen → "1 order gaat mee. 1 order met een andere verzendwijze
  wordt overgeslagen." → `PATCH` met alleen de zeevrachtorder. Orderpagina: uit zending halen en
  weer toevoegen. Statussen als medewerker: melding, 0 knoppen. Als beheerder: leeg toevoegen →
  fase, naam, code en volgorde tegelijk met focus op de fase; code "wacht_op_vlucht" voorgesteld,
  "in_transit" → "De code in_transit bestaat al."; onzichtbaar maakt "Klant e-mailen" uit en
  onbruikbaar; `POST shipment_statuses` met code, fase, `is_terminal` false, actief; wijzigen →
  `PATCH …?code=eq.pending` zonder code/fase; deactiveren met "3 orders staan nu op deze status
  en houden die" → `PATCH {active:false}`; de laatste actieve "Aangemeld" → rode melding en geen
  bevestigknop; activeren → `PATCH {active:true}`; daarna biedt de statusdialoog de nieuwe
  status aan en de gedeactiveerde niet.
- Gevonden en opgelost tijdens de controle: query-keys van één order/zending kregen een eigen
  `"id"`-segment (`/admin/orders/list` en `/admin/zendingen/list` deelden anders de cache met
  de lijst en kregen een array als order); zendingentabel paste niet op 1280 px (datum en tijd
  mogen nu onder elkaar); statustabel op 1280 px gaf de omschrijving te weinig ruimte (staat nu
  onder de naam); knoppen "Deactiveren"/"Activeren" hadden een rommelige toegankelijke naam (nu
  "Status ‘…’ deactiveren"); voettekst van "Orders toevoegen" viel op telefoons onder de knoppen.

## Niet geverifieerd / open punten na P4 deel B

- Niets van P4-B is tegen het live Supabase-project gedraaid. Niet live bevestigd: de
  `PATCH orders` met `id=in.(…)` + `service_type`/`shipment_id`-filter en `select=id` door
  staff, de unieke index op `upper(shipment_number)` als 23505 via PostgREST, en `insert`/
  `update` op `shipment_statuses` door een beheerder.
- ~~De database dwingt niet af dat een order dezelfde verzendwijze heeft als zijn zending~~:
  opgelost in de P4-reviewronde (migratie `20261007120000_p4_order_guards.sql`, ook voor de
  klant die een aangemelde order in een zending wilde omzetten). Bestaande afwijkingen van
  vóór de migratie blijven staan; de zendingpagina waarschuwt ervoor.
- ~~"Status voor hele zending wijzigen" mag ook een nog niet ontvangen order meenemen~~ en
  ~~één ophalernaam voor alle klanten~~: opgelost in de P4-reviewronde (niet-ontvangen orders
  blijven staan; afgeven gaat per klant, ook in de database).
- De fase van een bestaande status kan in de app niet worden gewijzigd (de database staat het
  beheerders wel toe): dat zou bestaande orders en historie stil herindelen. Wie het echt wil,
  maakt een nieuwe status en deactiveert de oude.
- Zendingen worden nooit verwijderd (geen delete-grant); een lege of foutieve zending blijft in
  de lijst staan.
- Het aantal orders per status en de zendingtellingen laden alle orders (`status`,
  `shipment_id`) in de browser; prima voor het huidige volume.

## Bewijs P4 deel A (2026-10-07)

- `bun run test`: 40 testbestanden, 525 tests groen (1 skipped, de bestaande tijdafhankelijke
  test rond middernacht Paramaribo); nieuw: `lib/admin/{orders,statuses,order-actions,dashboard}.test.ts`,
  uitgebreid `server-fns/middleware.test.ts` en `server/order-notifications.test.ts`, en PGlite
  `supabase/tests/pglite/admin_contract.test.ts` (20 tests). `bunx tsc --noEmit` schoon; eslint
  (incl. prettier) op alle gewijzigde en nieuwe bestanden: 0 fouten, 0 waarschuwingen;
  `bun run build` en `VERCEL=1 bun run build` slagen (`.vercel/output` aanwezig).
- PGlite-contract: de actiecode van de app (`lib/admin/order-actions.ts`, dezelfde die de
  server functions draaien) loopt ongewijzigd tegen de echte migraties via een kleine
  supabase-js-vervanger (`rpc()` → `select * from public.<rpc>(arg => $n)`, `from().select/insert`),
  dus RPC-namen, argumentnamen en payloads zijn die van productie. Bewezen: staff maken een order
  voor een klant zonder login (`created_by_role` staff, beginstatus, referentie; zeevracht mag
  voor staff), gedeactiveerde klant 55000, klant voor een ander 42501, extra pakket via een
  extra pakket → hoofdorder met overgenomen gegevens, hoofdorder van andere klant 22023;
  `receive_order` zet gewicht (afgerond op 2 decimalen), ontvangen door, US-magazijn en plant één
  e-mail, opnieuw ontvangen corrigeert alleen het gewicht (geen nieuwe historie), klant 42501;
  `canReceive()` komt voor elke fase overeen met wat `receive_order` accepteert; bulkwijziging
  van 3 orders van 2 klanten = één aanroep, 3 historieregels "door" de staff-login met bericht,
  2 geplande e-mails, nogmaals = niets gewijzigd; geen e-mail bij schakelaar uit of
  niet-zichtbare status; "Actie vereist" zonder bericht 22023, met bericht leesbaar voor de klant;
  inactieve status 22023; klant kan geen status wijzigen of afgeven (42501); `pay_before_pickup`:
  55000 met hint, ook via `changeOrderStatus`, "Toch afgeven" zet afgehaald door/afgegeven
  door/tijd en `audit_log.reason`; facturen-kolommen lezen hetzelfde saldo; annuleringsverzoek
  "behouden" = taak afgehandeld (`resolved_by` door trigger), klant ziet/wijzigt geen taken,
  "annuleren" sluit de taak zelf; interne notities alleen staff (klant 0 rijen, insert 42501,
  notitie bij andermans order 22023); documenten: staff uploaden in een afgeronde order,
  verwijderen rij + object, klant kan niet verwijderen; staff lezen elkaars naam (profiles),
  klant niet; `checkRole()` met de eigen client: staff ja, klant 42501.
- Browsercontrole (Playwright tegen de dev-server). Browserkant: Supabase Auth/REST/Storage
  volledig gestubd (geen enkel verzoek naar het live project); serverkant: de dev-server draaide
  met `SUPABASE_URL` naar een lokale nep-Supabase die dezelfde in-memory database deelt, zodat
  `changeOrderStatusFn`, `pickupFn`, `receiveOrderFn` en `createOrderForCustomerFn` echt werden
  uitgevoerd met het token van de gebruiker. Pagina's `/admin`, `/admin/orders` (+ zoeken op
  tracking met streepjes, dubbel trackingnummer, onbekend nummer, "gr 17", "Wacht op
  ontvangst"), negen orderpagina's (aangemeld, klaar voor afhalen met open facturen, B2B actie
  vereist, extra pakket met verborgen status in de historie, B2B in Suriname zonder
  douanedocumenten, afgehaald, open annuleringsverzoek, geannuleerd, onbekende id),
  `/admin/orders/nieuw` (leeg, met `?tracking=`, met `?parent=<extra pakket>` → hoofdorder) op
  320, 390, 768, 1024, 1280 en 1440 px: geen horizontale scroll, axe 0 overtredingen, geen
  consolefouten (een `<div>` in `<p>` gevonden en opgelost).
- Interacties (1440 en 390 px): scannen "1z999aa1-0123456784" + Enter → "Gevonden" → dialoog
  (leeg, 0 en 3 decimalen geweigerd zonder serververzoek, focus op het veld) → `receive_order`
  met 2.45 → toast, lijst bijgewerkt; twee orders selecteren → één `change_order_status` met
  beide ids en het bericht; "Afgeven aan klant" bij open facturen: blokkade met INV-nummers en
  bedragen per valuta, naam + reden verplicht → `pickup_override` met reden (auditregel); als
  de browser geen open factuur ziet maar de database wel: 55000-hint → dialoog schakelt naar
  "Toch afgeven" → geslaagd; "Documenten opvragen" voorgeselecteerd, zonder bericht geweigerd met
  focus op het bericht; B2B naar "Bij de douane" toont de waarschuwing en gaat door; annulering
  "behouden" → PATCH `staff_tasks`, banner "afgehandeld … door Maria Staff"; "Order annuleren"
  opent de dialoog met "Geannuleerd"; notitie leeg geweigerd, daarna POST `internal_notes`;
  document uploaden (soort standaard "Commerciële factuur" bij B2B, pad
  `{customer_id}/{order_id}/{uuid}.pdf`) en verwijderen (rij, dan object); download via
  `sign` met `expiresIn: 300`; order aanmaken: lege verzending toont klant-, winkel- en
  omschrijvingsfout tegelijk met focus op de klant, gedeactiveerde klant niet kiesbaar, "107"
  vindt GR00107, aanmaken + ontvangen → POST `orders` (alleen klant-bewerkbare kolommen +
  `customer_id`/`parent_order_id`) en `receive_order` met 3.5, door naar de orderpagina;
  dashboard: tellingen kloppen na de acties, "Afgehandeld" → PATCH, tellerlink →
  `/admin/orders?cancellation=true`; servicefout → "De status is niet gewijzigd. Er ging iets
  mis.", geweigerde rol op de server → "U heeft geen toegang tot deze actie." (de 42501 komt nu
  als data aan).

## Niet geverifieerd / open punten na P4 deel A

- Niets van P4-A is tegen het live Supabase-project gedraaid (opdracht: geen data schrijven).
  Niet live bevestigd: de embeds `customer:customers(...)` en `shipment:shipments(...)`, de
  `count=exact`-tellingen, `.not('order_id','is',null)` op `invoice_items`, en Storage
  `remove()` door staff.
- E-mail: "Klant e-mailen" en de geplande ontvangers (met `historyIds`) gaan naar de P8-haak
  `onOrderStatusChanged` (`src/server/order-notifications.ts`); er wordt nog niets verstuurd en
  de dialogen en toasts zeggen dat ("E-mail is nog niet geconfigureerd").
  Ontvangen gebruikt de `notify_customer` van de US-magazijnstatus (geen schakelaar in die
  dialoog).
- "Order behouden" sluit alleen de staff-taak: `orders.cancellation_requested_at` blijft staan
  (geen client mag die kolom wijzigen), dus het portaal blijft "U heeft op … gevraagd om deze
  order te annuleren" tonen en de klant kan niet opnieuw aanvragen. Zie "Carry-over fixes".
- De reden van "Toch afgeven" staat in `audit_log` (alleen admins lezen die); de
  staff-historie toont hem nog niet (P9 auditweergave).
- Het orderoverzicht laadt alle orders, factuurregels en open annuleringstaken in de browser
  (per 1000 gepagineerd) en filtert daar; prima voor het huidige volume, bij tienduizenden
  orders server-side filteren.
- Staff mogen elke verzendwijze kiezen bij "Order aanmaken voor klant" (de database laat staff
  ook een uitgeschakelde verzendwijze toe); er is dan mogelijk nog geen tarief.
- Verwijdert Storage het object niet nadat de rij is verwijderd, dan blijft het bestand
  wees-achter (melding aan de medewerker); de geplande opruimjob staat al open (P8/P10).
- Een order zonder klantlink (klantpagina `/admin/klanten/$id`) toont de naam zonder link tot P5.

## Bewijs P3 deel A (2026-10-07)

- `bun run test`: 29 testbestanden, 384 tests groen (1 skipped); `bunx tsc --noEmit` schoon;
  `bun run build` en `VERCEL=1 bun run build` slagen; eslint op alle gewijzigde bestanden:
  0 fouten (1 bestaande waarschuwing in `components/ui/form.tsx`).
- Browsercontrole (Playwright tegen de dev-server; Supabase Auth, REST en Storage volledig
  gestubd, geen enkel verzoek naar het live project): `/portal`, `/portal/orders`
  (+ `?stage=in_progress`), `/portal/orders/$id` voor de fasen registered, action_required
  (B2B), ready_for_pickup, in_transit (extra pakket), onbekende en ongeldige id; op 320, 390,
  768, 1024 en 1440 px: geen horizontale scroll, axe 0 overtredingen, geen consolefouten.
  Leeg (geen orders/facturen/adres) en fout (orders-endpoint 500) gecontroleerd.
- Interacties met gestubde responses: zoeken/filters/sorteren schrijven de URL; upload
  weigert leeg/svg/>10 MB vooraf, uploadt naar `{customer_id}/{order_id}/{uuid}.pdf` en
  schrijft `order_documents` met de oorspronkelijke bestandsnaam; download roept
  `sign` aan met `expiresIn: 300` en de pagina blijft open; wijzigen stuurt alleen
  klant-bewerkbare kolommen (PATCH, toast "Wijzigingen opgeslagen."), validatiefouten
  inline; annuleren via `rpc/request_order_cancellation` na bevestiging; "Extra pakket
  toevoegen" gaat naar `/portal/orders/nieuw?parent=<root-id>`.

## Bewijs P3 deel B (2026-10-07)

- `bun run test`: 33 testbestanden, 428 tests groen (1 skipped); `bunx tsc --noEmit` schoon;
  `bun run build` en `VERCEL=1 bun run build` slagen; eslint op alle gewijzigde bestanden: 0
  fouten, 0 waarschuwingen.
- Browsercontrole (Playwright tegen de dev-server). Browserkant: Supabase Auth/REST/Storage
  gestubd zoals in deel A. Serverkant: de dev-server draaide met `SUPABASE_URL` naar een lokale
  nep-Supabase (127.0.0.1), zodat `registerOrderFn` echt werd uitgevoerd zonder het live project
  te raken. `/portal/orders/nieuw` (stap 1, persoonlijk, zakelijk, extra pakket, extra pakket via
  een extra pakket, onbekende en geannuleerde hoofdorder, ongeldige zoekparameters) op 320, 390,
  768, 1024 en 1440 px: geen horizontale scroll, axe 0 overtredingen, geen consolefouten; ook met
  lucht- én zeevracht aan.
- Interacties: leeg verzenden toont alle vijf fouten tegelijk (winkel, omschrijving, waarde,
  aankoopdatum, verboden goederen), focus op het eerste veld, geen serververzoek; leverdatum vóór
  aankoopdatum geweigerd; zonder vinkje focus op het vinkje; soort order wijzigen en de terugknop
  houden de ingevulde velden. Verzenden: de server function riep `auth/v1/user`,
  `rpc/current_customer_id` en `POST orders?select=id,reference` aan met het token van de
  gebruiker, met precies de 17 klant-bewerkbare kolommen + `customer_id` + `parent_order_id`.
  Documenten: svg en >10 MB vooraf geweigerd met reden, heic zonder MIME-type geaccepteerd, soort
  per bestand; eerste upload geforceerd mislukt → order blijft, melding + "Opnieuw proberen" →
  geslaagd → door naar de orderpagina; paden `{customer_id}/{order_id}/{uuid}.{ext}`. Limiet:
  54000 `open_order_limit` → de Nederlandse tekst als toast en blijvende melding, geen
  navigatie. Extra pakket vanaf de orderpagina: winkel/ordernummer alleen-lezen, insert met
  `parent_order_id` = hoofdorder; orderpagina toont "Extra pakket" en de hoofdorder. Het
  wijzigformulier van deel A (gedeelde velden) slaat vervoerder en inkoopwijze correct op.

## Bewijs P3 reviewronde (2026-10-07)

Twintig reviewbevindingen nagelopen; alle echte bevindingen opgelost behalve twee die een
migratie vragen (zie "Carry-over fixes"). Belangrijkste wijzigingen:

- Documenten: downloadnaam = ASCII-deel van de oorspronkelijke naam + de extensie van
  `storage_path` (`documentDownloadName`, ook voor staff in P5), dus geen `Factuur.html` of
  `factuur.pdf.exe` meer en geen verminkte namen met é/#/&/%; upload met `cacheControl: "0"`.
- Elke portalquery filtert zelf op de klant (`.eq('customer_id')`, inner joins voor historie en
  betalingen, `neq('status','draft')` voor facturen); `registerOrder` weigert een staff-login
  met klantdossier (42501).
- UI: uploaddialoog loopt niet meer over (320/390/768 px, ook met lange bestandsnamen);
  orderlijst: tabel vanaf 1280 px, kaarten (2 kolommen vanaf 768 px) daaronder, omschrijving
  zichtbaar en doorzoekbaar; afhaalbanner en -kaart melden een openstaande factuur; voortgang
  bij "Actie vereist" en "Geannuleerd"; enkelvoud ("1 dag", "1 van 1 order", "1 van 1
  document"); focus na een mislukte aanmelding; wijzigformulier vergrendelt soort order, winkel
  en ordernummer binnen een aankoop; "Gekozen datum: dd-mm-jjjj" onder datumvelden; links van
  de dashboardkaarten kloppen met hun tekst; afhaalkaart toont ook "Meenemen"; geannuleerde
  facturen in de activiteit op `cancelled_at`.
- B2B "Inkoop door G&R": winkel/waarde/aankoopdatum optioneel (leverancier volstaat), geplande
  datum tot 1 jaar vooruit; validatie in twee lagen zodat ook regels over meerdere velden bij
  de eerste verzending verschijnen.
- `bun run test`: 35 testbestanden, 454 tests groen (1 skipped), waaronder nieuw
  `scoping.test.ts` (alle portalqueries filteren op de klant) en PGlite
  `portal_contract.test.ts` (de echte payloads van de app tegen de migraties; vervangt het
  tijdelijke reviewbestand). `bunx tsc --noEmit` schoon; eslint op alle gewijzigde bestanden 0
  fouten, 0 waarschuwingen; `bun run build` en `VERCEL=1 bun run build` slagen.
- Browsercontrole (Playwright, Supabase volledig gestubd zoals in deel A/B; server functions
  tegen een lokale nep-Supabase): alle portalpagina's (vol en leeg) op 320, 390, 768, 1024 en
  1440 px: geen horizontale scroll, axe 0 overtredingen, geen consolefouten. Gemeten met de
  scripts van de review: dialoog binnen zijn randen bij alle breedtes en bestandsnamen;
  orderlijst 0/9 gebroken referenties/datums en geen gebroken tracking- of ordernummers
  (behalve een tracking met spaties, die op een spatie afbreekt); knop "Order aanmelden"
  16 px onder de intro en 24 px boven het filterpaneel op telefoons; zoeken op
  "Sportschoenen"/"keukenmixer" vindt de order; na de 54000-fout staat de focus op de
  melding, na het formulier op de uploadkop; B2B-inkoop door G&R verzonden zonder winkel,
  waarde en datum (insert met `null`'s, `purchase_mode: gr_purchases`).

## Niet geverifieerd / open punten na P3 deel B

- Niets van P3-B is tegen het live Supabase-project gedraaid. Niet live bevestigd: de
  `orders_before_insert`-trigger met een echte klantsessie (beginstatus, referentie, limiet),
  `check_order_parent` en de storage-policy bij uploaden direct na het aanmaken.
- Fouten die vóór de handler ontstaan (bijv. `requireSupabaseAuth`: verlopen of ontbrekend
  token) komen in de browser alleen met hun bericht aan en worden als algemene foutmelding
  getoond. ~~Hetzelfde geldt voor `requireStaff`/`requireAdmin` (P2b)~~: opgelost in P4-A, die
  geven de weigering als `context.access` door en de handlers geven de 42501 als data terug.
- Geen idempotentiesleutel: valt de verbinding weg nadat de server de order heeft aangemaakt,
  dan kan opnieuw verzenden een tweede order geven (de tabel heeft er geen kolom voor; de
  knop is tijdens verzenden uitgeschakeld en na succes vervangt de orderpagina het formulier).
- Uploadvoortgang is per bestand (wacht / bezig / geüpload / niet geüpload), niet per byte:
  supabase-js `upload()` meldt geen voortgang.
- `declared_weight_lbs`: het formulier accepteert leeg of > 0 (de databasecheck is `> 0`),
  dus 0 lbs wordt in de browser al geweigerd.
- Aanmelden vraagt de geschatte waarde en de aankoopdatum verplicht (wijzigen niet), behalve
  bij B2B "Inkoop door G&R"; de aankoopdatum mag bij aanmelden maximaal 2 jaar terug, de
  verwachte leverdatum maximaal 1 jaar vooruit. Winkel (of bij inkoop door G&R: winkel of
  leverancier) en de regel "geen aankoopdatum in de toekomst" gelden bij aanmelden én wijzigen.

## Niet geverifieerd / open punten na P3 deel A

- Niets van P3-A is tegen het live Supabase-project gedraaid (opdracht: geen data schrijven).
  Niet live bevestigd: RLS-filtering van `shipment_status_history`/`invoice_items`, de
  storage-policies bij upload, `Content-Disposition: attachment` van de signed URL
  (`download`-optie), en de Nederlandse triggerfouten (55000/42501) bij wijzigen.
- De paginatitel van `/portal/orders/$id` is "Orders | G&R Activate" (geen loader; de
  referentie staat in de h1).

## Niet geverifieerd / open punten na P2b

- Live round trips met Supabase Auth (registreren → bevestigingsmail → `/auth/confirm`,
  wachtwoord-reset, opnieuw versturen) zijn niet live getest; alleen met gestubde
  Auth-responses en unit-tests.
- Of `banned_until` voor een gedeactiveerde klant via `getUser()` terugkomt en of
  `signInWithPassword` `user_banned` geeft, is niet live bevestigd (code vangt beide af).
- Eigenaar-acties uit `docs/DEPLOYMENT.md`: Site URL en exacte redirect-URL's (§3.1),
  "Confirm email" AAN (§3.2), minimale wachtwoordlengte 8 (§3.3), CAPTCHA uit (§3.4),
  e-mailtemplates plakken (§5), eerste beheerder (§4), Vercel-project en variabelen (§1).
- Openbare registratie werkt pas voor echte klanten met Resend-SMTP (P8); advies in
  DEPLOYMENT §3.2: `public_signup_enabled` uit tot dan.
- Een bevestigde login zonder klantdossier krijgt neutrale tekst; alleen het
  e-mailconflict maakt een staff-taak (sign-up uitgeschakeld tijdens bevestiging niet).
- TODO's in DEPLOYMENT: §5/§6/§7 (P8), §8/§9 (P10).

## Open business inputs (default in gebruik)

| Item | Default |
|---|---|
| Betekenis `purchase_mode` ('customer_purchased','gr_purchases') bij B2B | klant koopt zelf / G&R koopt in namens klant (uitleg in het formulier; optioneel) |
| Vervoerderslijst in het aanmeldformulier | UPS, FedEx, USPS, DHL, Amazon Logistics, OnTrac + "Anders" (vrije tekst) |
| US-magazijnadres (`warehouse_addresses`) | geen adres; kaart toont "Ons US-adres wordt binnenkort hier getoond." |
| BTW-tarief en BTW-uitsplitsing | vat_rate_percent null, show_vat_breakdown false |
| Bankrekeningen USD/EUR/SRD | drie lege rijen; waarschuwing "Bankgegevens ontbreken" |
| Tarief per lb lucht/zee, minimum, afronding | rate null, sea uit, rounding 'none' |
| Startnummer nieuwe klantcodes | één boven hoogste geïmporteerde nummer, minimaal 100 |
| Huidige factuurnummering (teller per jaar) | start bij INV-{YYYY}-0001 |
| KKF- en BTW-nummer G&R | null (regel niet getoond) |
| Afhaaltijden | null ("Nog niet ingesteld") |
| Algemene voorwaarden / verboden goederen | placeholders, geen gegenereerde juridische tekst |
| Bezorging beschikbaar | false |

## Carry-over fixes

- ~~Storage-upload in de map van een afgeronde/geannuleerde of andermans order~~ en
  ~~extra pakket kan afwijken van de hoofdorder~~: opgelost in migratie
  `20261007090000_order_hardening.sql` (`can_upload_order_object()` in de storage-policy,
  trigger `orders_group_consistency`; staff mogen corrigeren). Tests in
  `portal_contract.test.ts` en `m2_operations.test.ts`. ~~Geplande serverjob die
  storage-objecten zonder `order_documents`-rij via de Storage API opruimt~~: opgelost in P8
  (stap in de dagelijkse cronronde, `src/server/storage-cleanup.ts` + RPC
  `orphan_order_document_objects()` in `20261008090000_p8_reminders.sql`, alleen service_role,
  objecten ouder dan 24 h; tests `storage-cleanup.test.ts`, PGlite `p8_reminders`).

- ~~Zending en verzendwijze~~: opgelost in `20261007120000_p4_order_guards.sql` (triggers
  `orders_shipment_service_type` en `shipments_service_type_guard`; tests in
  `shipments_contract.test.ts`). Eigenaar: migratie toepassen en `types.ts` verversen (de
  types veranderen niet: alleen functies en triggers).

- ~~Annuleringsverzoek "behouden"~~: opgelost in `20261007150000_p5_customers.sql`
  (`keep_order_after_cancellation_request(_order_id, _customer_message)`: verzoek leeg, taak
  gesloten en een klantzichtbaar bericht op de geschiedenis van de order, in één transactie;
  tests in `customers_contract.test.ts`). Eigenaar: migratie toepassen; de UI valt tot dan
  terug op alleen de taak sluiten (dan zonder bericht).

- ~~`handle_new_user` maakt geen staff-taak bij registreren-uit of een open
  staff-uitnodiging~~: opgelost in dezelfde migratie (taken `signup_customer_failed` en
  `signup_email_conflict`, gesloten door `redeem_invitation`; tests in
  `customers_contract.test.ts` en `m1_identity.test.ts`).

## Later (buiten scope v1, §35.16)

- Uploaden van betaalbewijs door klanten
- Barcode-ontvangstscherm en register van onbekende pakketten
- Automatische opslag te late betaling
- In-app notificatie-inbox en orderchat
- Captcha en IP-rate-limit-tabellen
- Engelse UI
- Meerdere logins per zakelijke klant
- Online kaartbetalingen
