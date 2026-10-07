# G&R Activate — Voortgang

Bron: `docs/SPEC.md` (§1–§35). §35 gaat voor bij verschillen.

## Status per sectie

Laatst bijgewerkt: P4 reviewronde (2026-10-07): 26 reviewbevindingen nagelopen en opgelost,
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
| 4 | Klantaccount & GR-code | deels | DB + GR-nummering (P2a, `m1_identity.test.ts`); portal toont naam + GR-code uit `customers` (P2b); klantbeheer P5 |
| 5 | Uitnodigingen / bestaande klanten | deels | alleen database (P2a); uitnodigingspagina's en beheer P5 |
| 6 | Authenticatie | klaar (P2b), live niet geverifieerd | `/login`, `/registreren`, `/wachtwoord-vergeten`, `/auth/confirm`, `/auth/set-password`, uitloggen; guards `/portal` (klant) en `/admin` (staff/admin); tests `auth-errors`, `callback`, `guards`, `redirect`, `roles`, `schemas`; e-mailtemplates in `supabase/templates/` (`auth-templates.test.ts`) |
| 7 | Homepage | basis (P2b) | `/` met hero, "Hoe het werkt", diensten, contact uit `public_company_info()`; definitieve versie P10 |
| 8 | Klantdashboard | klaar (P3-A) | `/portal`: GR-code (kopiëren), eerste kaart "Uw persoonlijk US-verzendadres" (`warehouse_addresses`, `{FULL_NAME}`/`{GR_CODE}` ingevuld, kopieerknop per veld + "Kopieer volledig adres", leeg: "Ons US-adres wordt binnenkort hier getoond."), KPI's Orders ("Waarvan N nog niet ontvangen" linkt naar `?stage=registered`, "Alle orders bekijken") / Openstaande facturen (`invoice_overview` open+deels betaald, saldo per valuta, achterstallig, links naar de orders met een open factuur, achterstallige eerst) / Zendingen onderweg / Klaar voor afhalen (op `stage`; afhaaladres, -tijden en "Meenemen" elk los getoond; "Betaal eerst de openstaande factuur voordat u ophaalt" bij een klaarliggende order met open factuur, volgens `pay_before_pickup`), laatste order (met omschrijving), recente activiteit (orders + `shipment_status_history` + uitgegeven én geannuleerde facturen (op `cancelled_at`) + betalingen), CTA "Order aanmelden"; elke query filtert ook zelf op `customer_id` (RLS laat staff alles zien); tests `orders`, `invoices`, `warehouse`, `activity`, `scoping` |
| 9 | Order aanmelden | klaar (P3-B) | `/portal/orders/nieuw`: stap 1 "Persoonlijke order" / "Zakelijke order (B2B)" met uitleg (`?type=` in de URL, terugknop werkt, ingevulde velden blijven staan); formulier: verzendwijze (alleen `service_rates.enabled`, standaard lucht), winkel, ordernummer, omschrijving, aantal, geschatte waarde + valuta (USD/EUR/SRD), aankoopdatum, verwachte leverdatum (optioneel; onder elk datumveld "Gekozen datum: dd-mm-jjjj", omdat de browser het veld in zijn eigen notatie toont), trackingnummer "Optioneel / indien bekend", vervoerder (lijst UPS/FedEx/USPS/DHL/Amazon Logistics/OnTrac + "Anders" + "Nog niet bekend"), gewicht lbs (optioneel), opmerking; B2B: leverancier, PO-nummer, inkoopwijze met uitleg (vóór "Aankoop"; bij "Inkoop door G&R" zijn winkel, waarde en aankoopdatum optioneel, mag de leverancier de winkel vervangen en mag de geplande aankoopdatum tot 1 jaar vooruit; dezelfde regels bij wijzigen); documenten (optioneel, soort per bestand, type/grootte vooraf gecontroleerd, max. 10); verplicht vinkje "Mijn zending bevat geen verboden goederen" met link naar `/verboden-goederen`. `registerOrderFn` (`lib/server-fns/orders.functions.ts`): `requireSupabaseAuth` + zod (zelfde schema als het formulier), klant via `rpc('current_customer_id')` (een staff-login met klantdossier wordt geweigerd, 42501), insert met de client van de gebruiker (RLS + `orders_before_insert`), geeft id + referentie; P8-haak `onOrderRegistered` in `src/server/order-notifications.ts`. Daarna uploadt de browser de documenten één voor één met status per bestand; mislukt er een, dan blijft de order bestaan, met melding, "Opnieuw proberen" en "Naar de order". Toast "Order succesvol aangemeld." en door naar de orderpagina. Bij een mislukte aanmelding gaat de focus naar de foutmelding, bij het uploadscherm naar de kop. `?parent=<id>`: extra pakket (soort order, winkel en ordernummer van de hoofdorder; `registerOrderFn` neemt ze over van de hoofdorder, maar de database controleert het niet: een directe API-insert kan afwijken, zie "Carry-over fixes"; link naar een extra pakket wordt gevolgd naar de hoofdorder; geannuleerde hoofdorder geweigerd). Tests: `order-schema`, `register-order`, `document-queue`, `order-fields`, `order-notifications`, `app-routing` |
| 10 | Orderdetail | klaar (P3-A) | `/portal/orders` (zoeken op referentie/winkel/omschrijving/ordernummer/tracking, filter status-fase + "Onderweg en in behandeling", soort (Zakelijk-badge), sorteren op datum; omschrijving in tabel en kaarten; tabel vanaf 1280 px (referentie en datum op één regel, trackingkolom breed genoeg), daaronder kaarten (twee kolommen vanaf 768 px, label boven waarde); filters in de URL) en `/portal/orders/$id`: alle §10-velden, statusbadge, voortgang per fase + statusgeschiedenis (alleen customer_visible via RLS, wijzigingen als "G&R Solutions", klantbericht), voortgang buiten het normale pad: "Actie vereist" als huidige stap met de rest nog te gaan, geannuleerd eindigt met "Geannuleerd"; banner "Actie vereist" met upload, afhaalgegevens bij "Klaar voor afhalen" plus "Betaal eerst de openstaande factuur …" met openstaand bedrag per valuta en link naar de facturen, facturen via `invoice_items` → `invoice_overview` met badges en betaalinstructie, documenten (upload naar `order-documents` op `{customer_id}/{order_id}/{uuid}.{ext}`, type/grootte vooraf gecontroleerd, upload met `cacheControl: "0"`, download via `createSignedUrl(path, 300)` onder een veilige naam: ASCII-deel van de oorspronkelijke naam + de door de database gecontroleerde extensie van `storage_path`, `documentDownloadName()`), wijzigen zolang fase `registered` (soort order, winkel en ordernummer alleen-lezen bij een extra pakket en bij een hoofdorder met pakketten), "Annulering aanvragen" (`request_order_cancellation`, bevestigingsdialoog), gekoppelde pakketten + "Extra pakket toevoegen"; tests `orders`, `documents`, `order-fields`, `scoping`, `nav`, `app-routing`, PGlite `portal_contract` |
| 11 | Statusbeheer | klaar (P4; e-mail P8) | P4-B: `/admin/statussen` toont alle statussen per fase (in reisvolgorde, ook lege fasen) met naam, code, omschrijving voor de klant, zichtbaar voor klant, klant e-mailen, volgorde, actief/inactief, "Standaard" (eerste actieve status van de fase: daar starten nieuwe orders, daarheen gaat ontvangen en afgeven) en het aantal orders dat nu op elke status staat; staff lezen (melding "Alleen een beheerder …", geen knoppen), beheerders voegen toe (fase + code, beide daarna vast; code wordt uit de naam voorgesteld, uniek, `^[a-z][a-z0-9_]{1,49}$`; volgorde voorgesteld achter de fase), wijzigen naam/omschrijving/volgorde/zichtbaar/e-mailen (onzichtbare status mailt nooit) en deactiveren/activeren (nooit verwijderen; orders en historie houden de status; waarschuwing bij de laatste actieve status van een fase, de laatste "Aangemeld" wordt geweigerd zoals de database doet, 55000); alles met de eigen client (RLS `is_admin`), fouten inline + toast. Statuswijziging enkel en in bulk via één `change_order_status`-aanroep (`changeOrderStatusFn`, staff-client, nooit service role): dialoog met alleen actieve statussen per fase, "Bezorgd" alleen bij `delivery_available`, huidige status uitgeschakeld, bericht voor de klant ("Zichtbaar voor klant"; verplicht bij "Actie vereist"), "Klant e-mailen" (start op `notify_customer`, uit bij niet-zichtbare status; P8-haak `onOrderStatusChanged`, max. één e-mail per klant per actie via `planStatusEmails`), afhalen met naam ophaler + `pay_before_pickup`-blokkade (vooraf gecontroleerd én op de `pay_before_pickup`-hint van de database) en "Toch afgeven" met verplichte reden (`pickupFn` → `pickup_override`, reden in `audit_log`), B2B-waarschuwing (niet blokkerend) zonder commerciële factuur/paklijst richting douane, "Documenten opvragen" = "Actie vereist" voorgeselecteerd; volledige historie met namen ("door Maria", profiles), van → naar, tijd, bericht en "Niet zichtbaar voor klant". Tests: `admin/order-actions`, `admin/statuses`, `admin/orders`, `admin/status-config`, PGlite `admin_contract` en `shipments_contract`; P4-review: afgeven per klant (dialoog + database), "Toch afgeven" audit alleen op onbetaalde orders, nieuw bericht bij "Actie vereist" (eigen historieregel), niet-ontvangen orders blijven staan voorbij het US-magazijn, volgende status voorgeselecteerd, melding "E-mail is nog niet geconfigureerd" (migratie `20261007120000_p4_order_guards.sql`) |
| 12 | Admin-dashboard | deels (P2b, P4-A) | `/admin`: wie is ingelogd + rol, klantentellingen (`customers`); P4-A: ordertellingen op fase (wacht op ontvangst = fase registered + "actie vereist" vóór ontvangst, onderweg, douane, klaar voor afhalen, actie vereist, open annuleringsverzoeken), elk een link naar hetzelfde filter op `/admin/orders`; open taken (`staff_tasks`, nieuwste 8) met "Afgehandeld" (annuleringsverzoeken alleen via de orderpagina) en "Order openen"; facturen/klantbeheer P5–P7. Test `admin/dashboard`; P4-review: tegels voor elke fase (ook US-magazijn, aangekomen in Suriname, ingeklaard), open taken oudste eerst met "Alle N open taken tonen" |
| 13–20 | Klantbeheer t/m klanthistorie | niet gestart | P5–P9 (database staat er, P2a) |
| 21 | Admin order-/zendingbeheer | deels (P4 klaar; facturen genereren/wijzigen P6/P7, klantpagina P5) | P4-B zendingen: `/admin/zendingen` (zoeken op zendingnummer, vervoerder of AWB/container ook zonder streepjes, filter verzendwijze en "Alleen lopende zendingen", in de URL; tabel Zending \| Verzendwijze \| Vervoerder \| Vertrokken \| Aangekomen \| Orders (aantal, klanten, gemeten lbs) \| Status van de orders (aantal per fase, "Zending afgerond") vanaf 1280 px, past op 1280 zonder scrollen, kaarten daaronder; "Zending aanmaken" → de nieuwe zendingpagina). `/admin/zendingen/$id`: gegevens (alles zichtbaar voor klanten met een order erin, ook het bericht), inhoud (orders, klanten, gemeten gewicht, nog niet gewogen, per fase), waarschuwingen (order nog niet ontvangen, andere verzendwijze), orders met rij-acties (status, ontvangen, afgeven, "Uit zending halen") en selectie (status wijzigen, uit zending halen); "Orders toevoegen": alleen orders met dezelfde verzendwijze die niet afgehaald/bezorgd/geannuleerd zijn, ontvangen eerst, scannen + Enter vinkt de order met dat trackingnummer aan (anders zegt de melding waarom niet: andere verzendwijze, al afgerond, al in deze zending, onbekend, meerdere), een order uit een andere zending verhuist (badge "Nu in zending …"); één `PATCH orders` met `service_type=eq.<zending>` in het filter zelf; "Status voor hele zending wijzigen" = één `change_order_status` (via `changeOrderStatusFn`, P8-haak, max. één e-mail per klant) met alle lopende orders, afgeronde orders blijven staan; "Gegevens wijzigen" (verzendwijze vast zolang er orders in zitten); zendingnummer uniek ongeacht hoofdletters (eigen melding). "Aan zending toevoegen" ook vanuit een selectie op `/admin/orders` en op de orderpagina (vooraf: hoeveel orders meegaan en welke worden overgeslagen); de orderpagina toont de zending met "Uit zending halen" en een link. P4-A `/admin/orders`: groot zoek-/scanveld (tracking genormaliseerd, GR-code "gr 17", referentie, klantnaam/bedrijf zonder accenten, winkel, ordernummer, omschrijving), filters status-fase, soort (Zakelijk), "Wacht op ontvangst", "Openstaande factuur", "Annulering aangevraagd", sorteren (nieuwste, oudste, klant, status); tabel Order \| Klant \| Type \| Tracking \| Status \| Factuur \| Betaling vanaf 1280 px (past op 1280 zonder scrollen), kaarten daaronder; factuur/betaling alleen-lezen uit `invoice_items` → `invoice_overview` (concepten zichtbaar, per valuta); rij-acties openen, status wijzigen, ontvangen/gewicht corrigeren, afgeven; selectie → één bulk-statuswijziging; klantnaam zonder link (`/admin/klanten` komt in P5). Ontvangen zonder scanner (§35.7): exacte trackingmatch → "Ontvangen in US-magazijn" direct vanuit het zoekresultaat (`receiveOrderFn` → `receive_order`, gewicht ≤ 2 decimalen, Nederlandse komma), dubbel trackingnummer → waarschuwing + badge "Dubbel", geen match → "Order aanmaken voor klant" met het nummer. `/admin/orders/nieuw` (`createOrderForCustomerFn`): elke klant ook zonder login (gedeactiveerde niet kiesbaar), dezelfde velden als het portaal, optioneel direct ontvangen met gemeten gewicht, extra pakket via `?parent=`. `/admin/orders/$id`: klant, alle ordervelden, ontvangen/afgegeven door wie, zending (link naar `/admin/zendingen/$id`), facturen (ook concepten), documenten (upload in elke fase, download onder veilige naam, verwijderen), pakketten van de aankoop + "Extra pakket aanmaken", interne notities, voortgang en historie, banners voor annuleringsverzoek (annuleren of behouden), actie vereist, klaar voor afhalen (openstaand per valuta), ontbrekende douanedocumenten; P4-review: scanlus zonder klikken (veld leeg + focus na ontvangen), zoekresultaat direct onder het zoekveld met status en volgende stap, selectiebalk blijft in beeld, "Onbekend" als facturen niet laden, gewicht invullen na het magazijn, verzendwijze van een order in een zending vast (database) |
| 22 | Databaseontwerp | klaar (P2a) | `supabase/migrations/*.sql` (3 bestanden), `m1/m2/m3_*.test.ts` in PGlite |
| 23 | Row Level Security | klaar in DB (P2a) | RLS + grants per tabel, PGlite-tests; live RLS-tests P10 |
| 24 | E-mailsysteem | deels | auth-templates (P2b); Resend/herinneringen P8 |
| 25 | Responsive design | basis (P2b, P3-A, P3-B, P4) | publieke, auth-, portal- en admin-layouts gecontroleerd op 320–1440 px zonder horizontale scroll; P3-A: dashboard, orderlijst (tabel → kaarten) en orderdetail (facturentabel → kaarten via container query) op 320/390/768/1024/1440 px; P3-B: aanmeldformulier op dezelfde breedtes, velden 44 px hoog op telefoons, `inputmode` numeric/decimal, datumvelden; reviewronde: dialoogvensters krimpen met lange bestandsnamen mee (`grid-cols-[minmax(0,1fr)]`), orderlijst tabel pas vanaf 1280 px; eindronde P10; P4-A: admin-layout breder (`AppShell wide`), orderoverzicht tabel vanaf 1280 px (past op 1280 en 1440 zonder horizontaal scrollen, tabelkaart is `relative overflow-x-auto` als vangnet), kaarten met selectievakje daaronder, dialogen binnen 320–1440 px; P4-B: zendingenlijst, zendingpagina (orders als tabel vanaf 1280 px, kaarten daaronder) en statussen (tabel per fase vanaf 1280 px met de omschrijving onder de naam, kaarten daaronder) passen op 1280 px; dialogen (zending, orders toevoegen, aan zending toevoegen, status toevoegen/wijzigen/deactiveren) binnen 320–1440 px, knoppen op telefoons volle breedte; eindronde P10 |
| 26 | UX-eisen | deels (P2b, P3-A, P3-B, P4) | alle fouten bij eerste verzending zichtbaar, inline loginfouten, laad-/fout-/leegstaten, toasts; P3-A: elke kaart/sectie heeft eigen laad-, fout- (met "Opnieuw proberen") en leegstaat; P3-B: order aanmelden in twee stappen, alle veldfouten bij de eerste verzending (ook de regels over meerdere velden: validatie in twee lagen, `refineOrderFields`), focus op het eerste foute veld; P4-A: staff vinden een order met één zoekveld (Enter = direct zoeken, voor scanners), ontvangen vanuit het zoekresultaat, bulk-statuswijziging, statusdialoog toont alle fouten tegelijk en focust het eerste veld; P4-B: een hele zending in één keer van status wisselen, orders in een zending scannen, zending- en statusformulieren tonen alle fouten tegelijk met focus op het eerste veld |
| 27 | Beveiliging | deels (P2b) | geen geheimen in code (`server-boundary.test.ts`), `frame-ancestors`/nosniff/referrer-policy (`security-headers.test.ts`), adres-enumeratie verborgen op reset/resend |
| 28 | Audit trail | deels (P4) | audit-triggers in DB (P2a); P4-A: statuswijzigingen leesbaar op de orderpagina met wie/wanneer ("door Maria", `shipment_status_history.changed_by` → profiles), ontvangen door, afgegeven door, reden van "Toch afgeven" in `audit_log.reason`; P4-B: aanmaken/wijzigen van zendingen, verhuizen van orders tussen zendingen en elke statusconfiguratie-wijziging staan in `audit_log` via de bestaande triggers (bewezen in `shipments_contract`); generieke auditweergave P9 |
| 29 | Foutafhandeling | deels (P2b, P3-A, P3-B) | `src/lib/errors.ts` (Postgres/PostgREST → Nederlands), `auth-errors.ts`, 404- en foutpagina, Nederlandse toasts; P3-A: opslaan/annuleren/upload met succes- en fouttoast, uploadfouten (type/grootte/leeg/geweigerd) inline in het dialoogvenster; P3-B: aanmeldfouten als toast én blijvende melding boven de knop (o.a. 54000 `open_order_limit` met de Nederlandse databasetekst); server functions geven fouten terug als data (`TransportError` in `errors.ts`), omdat TanStack Start bij een gegooide fout alleen de `message` meestuurt; P4-A: `requireStaff`/`requireAdmin` gooien niet meer maar geven `context.access` door (de staff-client zit alleen in de geslaagde uitkomst), de handler geeft de 42501 als data terug, dus "U heeft geen toegang tot deze actie." komt in de browser aan; staff-dialogen tonen fouten inline én als toast |
| 30 | Geen statische demo | ok (P2b, P3-A, P3-B) | geen placeholder-cijfers; alles uit Supabase met de client van de klant (RLS), query-keys `["portal", userId, …]`, plus een expliciet filter op `customer_id`; enige "binnenkort"-tekst is de door §35.8 voorgeschreven melding zonder US-adres |
| 31 | End-to-end acceptatietest | niet gestart | P10 |
| 32 | Ontwikkelaanpak | lopend | fasen volgens §35.1 |
| 33 | Ontwerpprincipe | ok (P2b, P3-A, P4) | geen gradients/glas/paars; tabellen met crème kop en vette bruine labels (orderlijst, facturen, zendingen, statussen), kaarten op mobiel |
| 34 | Alleen vragen indien nodig | lopend | |
| 35 | Aanvullende specificaties | deels | §35.0 (UI alleen Nederlands, `src/lib/i18n/nl.ts`), §35.2, §35.3 (P2a), §35.4, §35.6, §35.14 klaar; P3-A: §35.7 klantkant (orders lezen/wijzigen, annulering aanvragen, documenten, statussen per fase), §35.8 US-adreskaart en `service_rates.enabled` in het wijzigformulier, §35.10 factuurbadges en saldo per valuta; P3-B: §35.7 klant-INSERT (alleen klant-bewerkbare kolommen + `customer_id` uit de database + `parent_order_id`), §35.8 `service_rates.enabled` in het aanmeldformulier en `max_open_orders_per_customer` (fout 54000 netjes getoond), §35.14 verplicht vinkje verboden goederen; overige subsecties in latere fasen; P4-A: §35.2 (privileged writes via server functions met `requireStaff`, staff-client, geen service role), §35.4 (staff doen alle orderwerk; geen admin-only actie geraakt), §35.7 staff-kant (statusvoorwaarden, ontvangen, afhalen met `pay_before_pickup` + override, actie vereist, B2B-waarschuwing, orders voor klanten zonder login, extra pakketten), §35.8 `delivery_available` en `pay_before_pickup`, §35.12 haakpunt "max. één e-mail per klant per actie", §35.13 leesbare statushistorie; P4-B: §35.4 (statussen wijzigen alleen beheerders, zendingen alle staff), §35.7 zendingen (staff-only batches, zelfde verzendwijze, "Status voor hele zending wijzigen" via `change_order_status`, klanten zien een zending alleen met een eigen order erin) en statussen (flexibel, per fase, deactiveren in plaats van verwijderen, "Bezorgd" alleen bij `delivery_available`) |

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

- (P5 of later, nieuwe migratie) Annuleringsverzoek "behouden": een guarded staff-RPC (bv.
  `decide_cancellation_request(_order_id, _keep boolean, _customer_message)`) die
  `cancellation_requested_at` leegmaakt bij "behouden" (met een klantzichtbare melding) en de
  taak sluit, zodat het portaal de aanvraag niet blijft tonen en de klant later opnieuw kan
  aanvragen. Nu sluit `/admin/orders/$id` alleen de taak (`staff_tasks.resolved_at`); de UI kan
  een nieuwe RPC pas gebruiken nadat de migratie live staat en `types.ts` is ververst.

- (P5, nieuwe migratie) `handle_new_user` maakt geen staff-taak wanneer
  `public_signup_enabled` uit staat op het moment van bevestigen of wanneer er een open
  staff-uitnodiging is; overweeg daar ook een taak, zodat staff elke login zonder
  klantdossier ziet. De portal toont nu een neutrale tekst voor alle gevallen.

## Later (buiten scope v1, §35.16)

- Uploaden van betaalbewijs door klanten
- Barcode-ontvangstscherm en register van onbekende pakketten
- Automatische opslag te late betaling
- In-app notificatie-inbox en orderchat
- Captcha en IP-rate-limit-tabellen
- Engelse UI
- Meerdere logins per zakelijke klant
- Online kaartbetalingen
