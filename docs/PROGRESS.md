# G&R Activate — Voortgang

Bron: `docs/SPEC.md` (§1–§35). §35 gaat voor bij verschillen.

## Status per sectie

Laatst bijgewerkt: P5 reviewronde (2026-10-07): 23 reviewbevindingen nagelopen (21 opgelost,
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
| 5 | Uitnodigingen / bestaande klanten | klaar (P5-A; e-mail P8) | "Klant uitnodigen" (nieuw of bestaand dossier, nooit een tweede dossier voor een adres: conflicten "heeft al een login", "al uitgenodigd", "gedeactiveerd", "andere code", "geen e-mail" met de weg vooruit), link alleen één keer op het scherm (kopiëren, WhatsApp), "Opnieuw versturen" (nieuw token, 1×/minuut, 5×/Surinaamse dag) en "Intrekken"; `/invite/$token`: geldig/verlopen/ingetrokken/gebruikt/ongeldig, pad a (nieuwe login), b (onbevestigde registratie), c (bestaande login: eerst inloggen), staff-uitnodiging (naam → profiel, daarna `/admin`); tests `server/invitations.test.ts`, `customers_contract.test.ts`; P5-review: limieten 1×/minuut en 5×/dag per e-mailadres (ook intrekken + opnieuw uitnodigen), linkdialogen vragen vóór sluiten zolang de link niet gekopieerd/gedeeld is, volledig e-mailadres in de WhatsApp-tekst en na activeren, conflict laat het formulier staan |
| 6 | Authenticatie | klaar (P2b), live niet geverifieerd | `/login`, `/registreren`, `/wachtwoord-vergeten`, `/auth/confirm`, `/auth/set-password`, uitloggen; guards `/portal` (klant) en `/admin` (staff/admin); tests `auth-errors`, `callback`, `guards`, `redirect`, `roles`, `schemas`; e-mailtemplates in `supabase/templates/` (`auth-templates.test.ts`) |
| 7 | Homepage | basis (P2b) | `/` met hero, "Hoe het werkt", diensten, contact uit `public_company_info()`; definitieve versie P10 |
| 8 | Klantdashboard | klaar (P3-A) | `/portal`: GR-code (kopiëren), eerste kaart "Uw persoonlijk US-verzendadres" (`warehouse_addresses`, `{FULL_NAME}`/`{GR_CODE}` ingevuld, kopieerknop per veld + "Kopieer volledig adres", leeg: "Ons US-adres wordt binnenkort hier getoond."), KPI's Orders ("Waarvan N nog niet ontvangen" linkt naar `?stage=registered`, "Alle orders bekijken") / Openstaande facturen (`invoice_overview` open+deels betaald, saldo per valuta, achterstallig, links naar de orders met een open factuur, achterstallige eerst) / Zendingen onderweg / Klaar voor afhalen (op `stage`; afhaaladres, -tijden en "Meenemen" elk los getoond; "Betaal eerst de openstaande factuur voordat u ophaalt" bij een klaarliggende order met open factuur, volgens `pay_before_pickup`), laatste order (met omschrijving), recente activiteit (orders + `shipment_status_history` + uitgegeven én geannuleerde facturen (op `cancelled_at`) + betalingen), CTA "Order aanmelden"; elke query filtert ook zelf op `customer_id` (RLS laat staff alles zien); tests `orders`, `invoices`, `warehouse`, `activity`, `scoping` |
| 9 | Order aanmelden | klaar (P3-B) | `/portal/orders/nieuw`: stap 1 "Persoonlijke order" / "Zakelijke order (B2B)" met uitleg (`?type=` in de URL, terugknop werkt, ingevulde velden blijven staan); formulier: verzendwijze (alleen `service_rates.enabled`, standaard lucht), winkel, ordernummer, omschrijving, aantal, geschatte waarde + valuta (USD/EUR/SRD), aankoopdatum, verwachte leverdatum (optioneel; onder elk datumveld "Gekozen datum: dd-mm-jjjj", omdat de browser het veld in zijn eigen notatie toont), trackingnummer "Optioneel / indien bekend", vervoerder (lijst UPS/FedEx/USPS/DHL/Amazon Logistics/OnTrac + "Anders" + "Nog niet bekend"), gewicht lbs (optioneel), opmerking; B2B: leverancier, PO-nummer, inkoopwijze met uitleg (vóór "Aankoop"; bij "Inkoop door G&R" zijn winkel, waarde en aankoopdatum optioneel, mag de leverancier de winkel vervangen en mag de geplande aankoopdatum tot 1 jaar vooruit; dezelfde regels bij wijzigen); documenten (optioneel, soort per bestand, type/grootte vooraf gecontroleerd, max. 10); verplicht vinkje "Mijn zending bevat geen verboden goederen" met link naar `/verboden-goederen`. `registerOrderFn` (`lib/server-fns/orders.functions.ts`): `requireSupabaseAuth` + zod (zelfde schema als het formulier), klant via `rpc('current_customer_id')` (een staff-login met klantdossier wordt geweigerd, 42501), insert met de client van de gebruiker (RLS + `orders_before_insert`), geeft id + referentie; P8-haak `onOrderRegistered` in `src/server/order-notifications.ts`. Daarna uploadt de browser de documenten één voor één met status per bestand; mislukt er een, dan blijft de order bestaan, met melding, "Opnieuw proberen" en "Naar de order". Toast "Order succesvol aangemeld." en door naar de orderpagina. Bij een mislukte aanmelding gaat de focus naar de foutmelding, bij het uploadscherm naar de kop. `?parent=<id>`: extra pakket (soort order, winkel en ordernummer van de hoofdorder; `registerOrderFn` neemt ze over van de hoofdorder, maar de database controleert het niet: een directe API-insert kan afwijken, zie "Carry-over fixes"; link naar een extra pakket wordt gevolgd naar de hoofdorder; geannuleerde hoofdorder geweigerd). Tests: `order-schema`, `register-order`, `document-queue`, `order-fields`, `order-notifications`, `app-routing` |
| 10 | Orderdetail | klaar (P3-A) | `/portal/orders` (zoeken op referentie/winkel/omschrijving/ordernummer/tracking, filter status-fase + "Onderweg en in behandeling", soort (Zakelijk-badge), sorteren op datum; omschrijving in tabel en kaarten; tabel vanaf 1280 px (referentie en datum op één regel, trackingkolom breed genoeg), daaronder kaarten (twee kolommen vanaf 768 px, label boven waarde); filters in de URL) en `/portal/orders/$id`: alle §10-velden, statusbadge, voortgang per fase + statusgeschiedenis (alleen customer_visible via RLS, wijzigingen als "G&R Solutions", klantbericht), voortgang buiten het normale pad: "Actie vereist" als huidige stap met de rest nog te gaan, geannuleerd eindigt met "Geannuleerd"; banner "Actie vereist" met upload, afhaalgegevens bij "Klaar voor afhalen" plus "Betaal eerst de openstaande factuur …" met openstaand bedrag per valuta en link naar de facturen, facturen via `invoice_items` → `invoice_overview` met badges en betaalinstructie, documenten (upload naar `order-documents` op `{customer_id}/{order_id}/{uuid}.{ext}`, type/grootte vooraf gecontroleerd, upload met `cacheControl: "0"`, download via `createSignedUrl(path, 300)` onder een veilige naam: ASCII-deel van de oorspronkelijke naam + de door de database gecontroleerde extensie van `storage_path`, `documentDownloadName()`), wijzigen zolang fase `registered` (soort order, winkel en ordernummer alleen-lezen bij een extra pakket en bij een hoofdorder met pakketten), "Annulering aanvragen" (`request_order_cancellation`, bevestigingsdialoog), gekoppelde pakketten + "Extra pakket toevoegen"; tests `orders`, `documents`, `order-fields`, `scoping`, `nav`, `app-routing`, PGlite `portal_contract` |
| 11 | Statusbeheer | klaar (P4; e-mail P8) | P4-B: `/admin/statussen` toont alle statussen per fase (in reisvolgorde, ook lege fasen) met naam, code, omschrijving voor de klant, zichtbaar voor klant, klant e-mailen, volgorde, actief/inactief, "Standaard" (eerste actieve status van de fase: daar starten nieuwe orders, daarheen gaat ontvangen en afgeven) en het aantal orders dat nu op elke status staat; staff lezen (melding "Alleen een beheerder …", geen knoppen), beheerders voegen toe (fase + code, beide daarna vast; code wordt uit de naam voorgesteld, uniek, `^[a-z][a-z0-9_]{1,49}$`; volgorde voorgesteld achter de fase), wijzigen naam/omschrijving/volgorde/zichtbaar/e-mailen (onzichtbare status mailt nooit) en deactiveren/activeren (nooit verwijderen; orders en historie houden de status; waarschuwing bij de laatste actieve status van een fase, de laatste "Aangemeld" wordt geweigerd zoals de database doet, 55000); alles met de eigen client (RLS `is_admin`), fouten inline + toast. Statuswijziging enkel en in bulk via één `change_order_status`-aanroep (`changeOrderStatusFn`, staff-client, nooit service role): dialoog met alleen actieve statussen per fase, "Bezorgd" alleen bij `delivery_available`, huidige status uitgeschakeld, bericht voor de klant ("Zichtbaar voor klant"; verplicht bij "Actie vereist"), "Klant e-mailen" (start op `notify_customer`, uit bij niet-zichtbare status; P8-haak `onOrderStatusChanged`, max. één e-mail per klant per actie via `planStatusEmails`), afhalen met naam ophaler + `pay_before_pickup`-blokkade (vooraf gecontroleerd én op de `pay_before_pickup`-hint van de database) en "Toch afgeven" met verplichte reden (`pickupFn` → `pickup_override`, reden in `audit_log`), B2B-waarschuwing (niet blokkerend) zonder commerciële factuur/paklijst richting douane, "Documenten opvragen" = "Actie vereist" voorgeselecteerd; volledige historie met namen ("door Maria", profiles), van → naar, tijd, bericht en "Niet zichtbaar voor klant". Tests: `admin/order-actions`, `admin/statuses`, `admin/orders`, `admin/status-config`, PGlite `admin_contract` en `shipments_contract`; P4-review: afgeven per klant (dialoog + database), "Toch afgeven" audit alleen op onbetaalde orders, nieuw bericht bij "Actie vereist" (eigen historieregel), niet-ontvangen orders blijven staan voorbij het US-magazijn, volgende status voorgeselecteerd, melding "E-mail is nog niet geconfigureerd" (migratie `20261007120000_p4_order_guards.sql`) |
| 12 | Admin-dashboard | klaar (P5-B) | `/admin`: "Nog in te stellen" (bankgegevens ontbreken per valuta, geen actief US-adres, geen verzendwijze aan, geen tarief per lb, afhaaltijden leeg, voorwaarden/verboden goederen nog voorbeeldtekst; voor beheerders ook servicesleutel, APP_URL en e-mail), elk met "Naar instellingen" naar de juiste sectie (scrolt en focust); "Overzicht": klanten totaal + nieuw in 30 dagen + actief/uitgenodigd/gedeactiveerd, nieuwe orders (30 dagen) + lopende orders, openstaande facturen (aantal + openstaand bedrag PER VALUTA, link naar klanten met openstaande facturen), achterstallig (aantal + bedrag per valuta, uit `invoice_overview.is_overdue`), betaalde facturen (+ laatste 30 dagen, concepten); ordertellingen per fase (P4); open taken met "Order openen" en nu ook "Klant openen" (`customer_id`); "Recente activiteit" (statuswijzigingen met "door …", nieuwe klanten, geaccepteerde uitnodigingen, uitgegeven/geannuleerde facturen, betalingen; links naar order en klant); "Systeemstatus" (beheerders, `systemStatusFn`: alleen booleans voor servicesleutel, APP_URL (of Vercel-adres), e-mailprovider, CRON_SECRET, plus de laatste herinneringsronde uit `job_runs`). Tests `admin/dashboard` (`summarizeInvoiceStats`, `mergeStaffActivity`, `daysAgo`), `admin/system-status` (`setupChecklist`), `server/system-status` (alleen booleans, nooit een waarde); P5-review: "Open taken" bovenaan, medewerkers zien de setup-lijst als één regel, laadfout in de setup-lijst zichtbaar met "Opnieuw proberen" |
| 13 | Klantbeheer | klaar (P5-A, P5-B) | `/admin/klanten`: zoeken op naam, bedrijf, GR-code ("gr 17", "17"), e-mail, telefoon (met/zonder +597), filters status, soort, login ja/nee, "Openstaande facturen", sorteren (GR-code, naam, nieuwste, oudste), alles in de URL; tabel Klant \| Contact \| Status \| Login \| Orders \| Openstaand \| Klant sinds vanaf 1280 px, kaarten daaronder. `/admin/klanten/$id`: contactgegevens (wijzigen; e-mail alleen beheerder, met waarschuwing bij login/open uitnodiging), account en login, uitnodigingsstatus met acties, orders (links), zendingen, facturen + betalingen (alleen-lezen, per valuta), documenten (download), interne notities, Nederlandse geschiedenis (beheerder: uit `audit_log`; staff: uit de rijen), "Order aanmaken voor deze klant" (`/admin/orders/nieuw?customer=`), wachtwoord-resetlink; P5-B: teampagina `/admin/team` en instellingen `/admin/instellingen` (zie §35 hieronder) |
| 14–20 | Facturen t/m klanthistorie | niet gestart | P6–P9 (database staat er, P2a); de klantpagina toont facturen en betalingen al alleen-lezen |
| 21 | Admin order-/zendingbeheer | deels (P4 klaar, klantpagina P5-A; facturen genereren/wijzigen P6/P7) | P4-B zendingen: `/admin/zendingen` (zoeken op zendingnummer, vervoerder of AWB/container ook zonder streepjes, filter verzendwijze en "Alleen lopende zendingen", in de URL; tabel Zending \| Verzendwijze \| Vervoerder \| Vertrokken \| Aangekomen \| Orders (aantal, klanten, gemeten lbs) \| Status van de orders (aantal per fase, "Zending afgerond") vanaf 1280 px, past op 1280 zonder scrollen, kaarten daaronder; "Zending aanmaken" → de nieuwe zendingpagina). `/admin/zendingen/$id`: gegevens (alles zichtbaar voor klanten met een order erin, ook het bericht), inhoud (orders, klanten, gemeten gewicht, nog niet gewogen, per fase), waarschuwingen (order nog niet ontvangen, andere verzendwijze), orders met rij-acties (status, ontvangen, afgeven, "Uit zending halen") en selectie (status wijzigen, uit zending halen); "Orders toevoegen": alleen orders met dezelfde verzendwijze die niet afgehaald/bezorgd/geannuleerd zijn, ontvangen eerst, scannen + Enter vinkt de order met dat trackingnummer aan (anders zegt de melding waarom niet: andere verzendwijze, al afgerond, al in deze zending, onbekend, meerdere), een order uit een andere zending verhuist (badge "Nu in zending …"); één `PATCH orders` met `service_type=eq.<zending>` in het filter zelf; "Status voor hele zending wijzigen" = één `change_order_status` (via `changeOrderStatusFn`, P8-haak, max. één e-mail per klant) met alle lopende orders, afgeronde orders blijven staan; "Gegevens wijzigen" (verzendwijze vast zolang er orders in zitten); zendingnummer uniek ongeacht hoofdletters (eigen melding). "Aan zending toevoegen" ook vanuit een selectie op `/admin/orders` en op de orderpagina (vooraf: hoeveel orders meegaan en welke worden overgeslagen); de orderpagina toont de zending met "Uit zending halen" en een link. P4-A `/admin/orders`: groot zoek-/scanveld (tracking genormaliseerd, GR-code "gr 17", referentie, klantnaam/bedrijf zonder accenten, winkel, ordernummer, omschrijving), filters status-fase, soort (Zakelijk), "Wacht op ontvangst", "Openstaande factuur", "Annulering aangevraagd", sorteren (nieuwste, oudste, klant, status); tabel Order \| Klant \| Type \| Tracking \| Status \| Factuur \| Betaling vanaf 1280 px (past op 1280 zonder scrollen), kaarten daaronder; factuur/betaling alleen-lezen uit `invoice_items` → `invoice_overview` (concepten zichtbaar, per valuta); rij-acties openen, status wijzigen, ontvangen/gewicht corrigeren, afgeven; selectie → één bulk-statuswijziging; klantnaam zonder link (P5-A: klantnamen op `/admin/orders`, `/admin/orders/$id` en `/admin/zendingen/$id` linken naar `/admin/klanten/$id`). Ontvangen zonder scanner (§35.7): exacte trackingmatch → "Ontvangen in US-magazijn" direct vanuit het zoekresultaat (`receiveOrderFn` → `receive_order`, gewicht ≤ 2 decimalen, Nederlandse komma), dubbel trackingnummer → waarschuwing + badge "Dubbel", geen match → "Order aanmaken voor klant" met het nummer. `/admin/orders/nieuw` (`createOrderForCustomerFn`): elke klant ook zonder login (gedeactiveerde niet kiesbaar), dezelfde velden als het portaal, optioneel direct ontvangen met gemeten gewicht, extra pakket via `?parent=`. `/admin/orders/$id`: klant, alle ordervelden, ontvangen/afgegeven door wie, zending (link naar `/admin/zendingen/$id`), facturen (ook concepten), documenten (upload in elke fase, download onder veilige naam, verwijderen), pakketten van de aankoop + "Extra pakket aanmaken", interne notities, voortgang en historie, banners voor annuleringsverzoek (annuleren of behouden), actie vereist, klaar voor afhalen (openstaand per valuta), ontbrekende douanedocumenten; P4-review: scanlus zonder klikken (veld leeg + focus na ontvangen), zoekresultaat direct onder het zoekveld met status en volgende stap, selectiebalk blijft in beeld, "Onbekend" als facturen niet laden, gewicht invullen na het magazijn, verzendwijze van een order in een zending vast (database) |
| 22 | Databaseontwerp | klaar (P2a) | `supabase/migrations/*.sql` (3 bestanden), `m1/m2/m3_*.test.ts` in PGlite |
| 23 | Row Level Security | klaar in DB (P2a) | RLS + grants per tabel, PGlite-tests; live RLS-tests P10 |
| 24 | E-mailsysteem | deels | auth-templates (P2b); Resend/herinneringen P8 |
| 25 | Responsive design | basis (P2b, P3-A, P3-B, P4) | publieke, auth-, portal- en admin-layouts gecontroleerd op 320–1440 px zonder horizontale scroll; P3-A: dashboard, orderlijst (tabel → kaarten) en orderdetail (facturentabel → kaarten via container query) op 320/390/768/1024/1440 px; P3-B: aanmeldformulier op dezelfde breedtes, velden 44 px hoog op telefoons, `inputmode` numeric/decimal, datumvelden; reviewronde: dialoogvensters krimpen met lange bestandsnamen mee (`grid-cols-[minmax(0,1fr)]`), orderlijst tabel pas vanaf 1280 px; eindronde P10; P4-A: admin-layout breder (`AppShell wide`), orderoverzicht tabel vanaf 1280 px (past op 1280 en 1440 zonder horizontaal scrollen, tabelkaart is `relative overflow-x-auto` als vangnet), kaarten met selectievakje daaronder, dialogen binnen 320–1440 px; P4-B: zendingenlijst, zendingpagina (orders als tabel vanaf 1280 px, kaarten daaronder) en statussen (tabel per fase vanaf 1280 px met de omschrijving onder de naam, kaarten daaronder) passen op 1280 px; dialogen (zending, orders toevoegen, aan zending toevoegen, status toevoegen/wijzigen/deactiveren) binnen 320–1440 px, knoppen op telefoons volle breedte; eindronde P10; P5-B: dashboard (KPI-kaarten 1/2/3/5 kolommen), team (tabel vanaf 1280 px, kaarten daaronder) en instellingen (secties, bankrekeningen 3 kolommen vanaf 1024 px, dialoog US-adres) op 320–1440 px zonder horizontale scroll |
| 26 | UX-eisen | deels (P2b, P3-A, P3-B, P4) | alle fouten bij eerste verzending zichtbaar, inline loginfouten, laad-/fout-/leegstaten, toasts; P3-A: elke kaart/sectie heeft eigen laad-, fout- (met "Opnieuw proberen") en leegstaat; P3-B: order aanmelden in twee stappen, alle veldfouten bij de eerste verzending (ook de regels over meerdere velden: validatie in twee lagen, `refineOrderFields`), focus op het eerste foute veld; P4-A: staff vinden een order met één zoekveld (Enter = direct zoeken, voor scanners), ontvangen vanuit het zoekresultaat, bulk-statuswijziging, statusdialoog toont alle fouten tegelijk en focust het eerste veld; P4-B: een hele zending in één keer van status wisselen, orders in een zending scannen, zending- en statusformulieren tonen alle fouten tegelijk met focus op het eerste veld; P5-A: klantdialogen tonen alle veldfouten bij de eerste verzending met focus op het eerste foute veld, live GR-code-controle, conflicten als uitleg met een knop naar de juiste klant, "Opnieuw versturen kan over N seconden" / daglimiet uitgelegd, `/invite` met één duidelijke stap per toestand; P5-B: instellingen per sectie opslaan (alleen gewijzigde kolommen, "Er was niets gewijzigd"), alle veldfouten tegelijk met focus op het eerste veld (ook regels over meerdere velden, zoals BTW-uitsplitsing zonder tarief), live waarschuwing als de betalingsvoorwaarden een andere termijn of opslag noemen dan ingesteld, live voorbeeld factuurnummer, live voorbeeld van het persoonlijke US-adres van een gekozen klant, live rekenvoorbeeld van het tarief; medewerkers zien de instellingen en het team alleen-lezen ("Nog niet ingesteld" bij lege waarden) |
| 27 | Beveiliging | deels (P2b) | geen geheimen in code (`server-boundary.test.ts`), `frame-ancestors`/nosniff/referrer-policy (`security-headers.test.ts`), adres-enumeratie verborgen op reset/resend; P5-A: service role alleen in `src/server/*` (dynamische import in server-function handlers) voor `auth.admin.*` en voor het opzoeken/inwisselen van een uitnodiging nadat het token is gecontroleerd en gehasht; uitnodigen zelf met de eigen sessie van staff (RLS); alleen de SHA-256 van het token in de database, het ruwe token één keer in de link; resetlinks voor logins die ook staff/beheerder zijn alleen door een beheerder; P5-B: een gedeactiveerde (gebande) login heeft in de database geen rol meer (`has_role`/`is_staff` negeren `auth.users.banned_until` in de toekomst), dus een nog geldig toegangstoken verliest direct alle rechten en uitnodigingen van die persoon werken niet meer; `set_user_role` houdt altijd een beheerder die kan inloggen; teamacties alleen voor beheerders (UI, server function én database); Systeemstatus geeft nooit een waarde of lengte van een geheim terug; P5-review: een login die bij het team hoort wordt nooit vanaf een klantpagina gebannen/ontbannen of gereset (ook niet de eigen), een uitnodiging van een gedeactiveerde uitnodiger telt als ingetrokken vóórdat Auth wordt aangeraakt, profielnaam en `user_metadata` komen uit de uitnodiging (niet van een vreemde die het adres vooraf registreerde), deactiveren van een teamlid trekt al diens uitnodigingen in met notitie per klant |
| 28 | Audit trail | deels (P4) | audit-triggers in DB (P2a); P4-A: statuswijzigingen leesbaar op de orderpagina met wie/wanneer ("door Maria", `shipment_status_history.changed_by` → profiles), ontvangen door, afgegeven door, reden van "Toch afgeven" in `audit_log.reason`; P4-B: aanmaken/wijzigen van zendingen, verhuizen van orders tussen zendingen en elke statusconfiguratie-wijziging staan in `audit_log` via de bestaande triggers (bewezen in `shipments_contract`); generieke auditweergave P9; P5-A: klantpagina "Geschiedenis" in het Nederlands uit `audit_log` (beheerder): aangemaakt met code, code gewijzigd (oud → nieuw + reden), gegevens gewijzigd (welke velden), uitgenodigd, opnieuw verstuurd, ingetrokken, login gekoppeld, gedeactiveerd/geactiveerd (reden), met wie en wanneer; staff zien dezelfde gebeurtenissen afgeleid uit de rijen; deactiveren/activeren en resetlinks laten ook een interne notitie achter; P5-B: elke instellingswijziging in `audit_log` via de bestaande triggers (alleen gewijzigde kolommen; bewezen in `team_settings_contract`), factuurteller en volgende klantcode via hun RPC's (eigen auditregel), rolwijzigingen (`user_roles`-trigger), deactiveren/activeren van een teamlid als auditregel `team_login` met reden (`log_team_login_change`) |
| 29 | Foutafhandeling | deels (P2b, P3-A, P3-B) | `src/lib/errors.ts` (Postgres/PostgREST → Nederlands), `auth-errors.ts`, 404- en foutpagina, Nederlandse toasts; P3-A: opslaan/annuleren/upload met succes- en fouttoast, uploadfouten (type/grootte/leeg/geweigerd) inline in het dialoogvenster; P3-B: aanmeldfouten als toast én blijvende melding boven de knop (o.a. 54000 `open_order_limit` met de Nederlandse databasetekst); server functions geven fouten terug als data (`TransportError` in `errors.ts`), omdat TanStack Start bij een gegooide fout alleen de `message` meestuurt; P4-A: `requireStaff`/`requireAdmin` gooien niet meer maar geven `context.access` door (de staff-client zit alleen in de geslaagde uitkomst), de handler geeft de 42501 als data terug, dus "U heeft geen toegang tot deze actie." komt in de browser aan; staff-dialogen tonen fouten inline én als toast; P5-B: instellingen- en teamfouten inline én als toast; servergedeelde helpers (`serviceFailure`, `screenBase`) staan nu in `src/server/fn-helpers.ts` (de import-bescherming van TanStack Start weigerde ze in een gedeelde module die ook in de browser zit) |
| 30 | Geen statische demo | ok (P2b, P3-A, P3-B) | geen placeholder-cijfers; alles uit Supabase met de client van de klant (RLS), query-keys `["portal", userId, …]`, plus een expliciet filter op `customer_id`; enige "binnenkort"-tekst is de door §35.8 voorgeschreven melding zonder US-adres |
| 31 | End-to-end acceptatietest | niet gestart | P10 |
| 32 | Ontwikkelaanpak | lopend | fasen volgens §35.1 |
| 33 | Ontwerpprincipe | ok (P2b, P3-A, P4) | geen gradients/glas/paars; tabellen met crème kop en vette bruine labels (orderlijst, facturen, zendingen, statussen), kaarten op mobiel |
| 34 | Alleen vragen indien nodig | lopend | |
| 35 | Aanvullende specificaties | deels | §35.0 (UI alleen Nederlands, `src/lib/i18n/nl.ts`), §35.2, §35.3 (P2a), §35.4, §35.6, §35.14 klaar; P3-A: §35.7 klantkant (orders lezen/wijzigen, annulering aanvragen, documenten, statussen per fase), §35.8 US-adreskaart en `service_rates.enabled` in het wijzigformulier, §35.10 factuurbadges en saldo per valuta; P3-B: §35.7 klant-INSERT (alleen klant-bewerkbare kolommen + `customer_id` uit de database + `parent_order_id`), §35.8 `service_rates.enabled` in het aanmeldformulier en `max_open_orders_per_customer` (fout 54000 netjes getoond), §35.14 verplicht vinkje verboden goederen; overige subsecties in latere fasen; P4-A: §35.2 (privileged writes via server functions met `requireStaff`, staff-client, geen service role), §35.4 (staff doen alle orderwerk; geen admin-only actie geraakt), §35.7 staff-kant (statusvoorwaarden, ontvangen, afhalen met `pay_before_pickup` + override, actie vereist, B2B-waarschuwing, orders voor klanten zonder login, extra pakketten), §35.8 `delivery_available` en `pay_before_pickup`, §35.12 haakpunt "max. één e-mail per klant per actie", §35.13 leesbare statushistorie; P4-B: §35.4 (statussen wijzigen alleen beheerders, zendingen alle staff), §35.7 zendingen (staff-only batches, zelfde verzendwijze, "Status voor hele zending wijzigen" via `change_order_status`, klanten zien een zending alleen met een eigen order erin) en statussen (flexibel, per fase, deactiveren in plaats van verwijderen, "Bezorgd" alleen bij `delivery_available`); P5-A: §35.5 (klant toevoegen, code wijzigen, deactiveren met `ban_duration`), §35.6 (uitnodigen, opnieuw versturen/intrekken, `/invite` paden a/b/c, staff-uitnodiging inwisselen), §35.12 WhatsApp-delen van uitnodigings- en resetlinks (e-mail P8: geen e-mail, de dialoog zegt dat); P5-B: §35.2 Systeemstatus (alleen booleans), §35.4 teampagina (staff lezen, beheerders: medewerker/beheerder uitnodigen met dezelfde tokenregels als klanten, rol wijzigen via `set_user_role` met bescherming van de laatste beheerder, login deactiveren/activeren met reden, resetlink), §35.8 volledig (`/admin/instellingen`: bedrijfsgegevens, facturen, herinneringen, werkwijze, afhalen, voorwaarden/verboden goederen, nummering, bankrekeningen, US-adressen, tarieven; beheerders wijzigen, staff lezen; setup-checklist op het dashboard), §35.9 `set_invoice_counter` (huidig jaar, geweigerd zodra er een factuur is), §35.5 `set_next_customer_number` |

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
  `portal_contract.test.ts` en `m2_operations.test.ts`. Nog open: geplande serverjob die
  storage-objecten zonder `order_documents`-rij via de Storage API opruimt (P8/P10).

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
