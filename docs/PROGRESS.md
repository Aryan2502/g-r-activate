# G&R Activate — Voortgang

Bron: `docs/SPEC.md` (§1–§35). §35 gaat voor bij verschillen.

## Status per sectie

Laatst bijgewerkt: P3 reviewronde (2026-10-07): bevindingen van de P3-review verwerkt
(zie "Bewijs P3 reviewronde"). Daarvoor P3 deel B (zelfde dag): order aanmelden
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
| 11 | Statusbeheer | niet gestart | P4 (database staat er, P2a) |
| 12 | Admin-dashboard | deels (P2b) | `/admin`: wie is ingelogd + rol, klantentellingen (`customers`), open taken (`staff_tasks`); rest P5 |
| 13–21 | Klantbeheer t/m order-/zendingbeheer | niet gestart | P4–P9 (database staat er, P2a) |
| 22 | Databaseontwerp | klaar (P2a) | `supabase/migrations/*.sql` (3 bestanden), `m1/m2/m3_*.test.ts` in PGlite |
| 23 | Row Level Security | klaar in DB (P2a) | RLS + grants per tabel, PGlite-tests; live RLS-tests P10 |
| 24 | E-mailsysteem | deels | auth-templates (P2b); Resend/herinneringen P8 |
| 25 | Responsive design | basis (P2b, P3-A, P3-B) | publieke, auth-, portal- en admin-layouts gecontroleerd op 320–1440 px zonder horizontale scroll; P3-A: dashboard, orderlijst (tabel → kaarten) en orderdetail (facturentabel → kaarten via container query) op 320/390/768/1024/1440 px; P3-B: aanmeldformulier op dezelfde breedtes, velden 44 px hoog op telefoons, `inputmode` numeric/decimal, datumvelden; reviewronde: dialoogvensters krimpen met lange bestandsnamen mee (`grid-cols-[minmax(0,1fr)]`), orderlijst tabel pas vanaf 1280 px; eindronde P10 |
| 26 | UX-eisen | deels (P2b, P3-A, P3-B) | alle fouten bij eerste verzending zichtbaar, inline loginfouten, laad-/fout-/leegstaten, toasts; P3-A: elke kaart/sectie heeft eigen laad-, fout- (met "Opnieuw proberen") en leegstaat; P3-B: order aanmelden in twee stappen, alle veldfouten bij de eerste verzending (ook de regels over meerdere velden: validatie in twee lagen, `refineOrderFields`), focus op het eerste foute veld |
| 27 | Beveiliging | deels (P2b) | geen geheimen in code (`server-boundary.test.ts`), `frame-ancestors`/nosniff/referrer-policy (`security-headers.test.ts`), adres-enumeratie verborgen op reset/resend |
| 28 | Audit trail | deels | audit-triggers in DB (P2a); weergave P9 |
| 29 | Foutafhandeling | deels (P2b, P3-A, P3-B) | `src/lib/errors.ts` (Postgres/PostgREST → Nederlands), `auth-errors.ts`, 404- en foutpagina, Nederlandse toasts; P3-A: opslaan/annuleren/upload met succes- en fouttoast, uploadfouten (type/grootte/leeg/geweigerd) inline in het dialoogvenster; P3-B: aanmeldfouten als toast én blijvende melding boven de knop (o.a. 54000 `open_order_limit` met de Nederlandse databasetekst); server functions geven fouten terug als data (`TransportError` in `errors.ts`), omdat TanStack Start bij een gegooide fout alleen de `message` meestuurt |
| 30 | Geen statische demo | ok (P2b, P3-A, P3-B) | geen placeholder-cijfers; alles uit Supabase met de client van de klant (RLS), query-keys `["portal", userId, …]`, plus een expliciet filter op `customer_id`; enige "binnenkort"-tekst is de door §35.8 voorgeschreven melding zonder US-adres |
| 31 | End-to-end acceptatietest | niet gestart | P10 |
| 32 | Ontwikkelaanpak | lopend | fasen volgens §35.1 |
| 33 | Ontwerpprincipe | ok (P2b, P3-A) | geen gradients/glas/paars; tabellen met crème kop en vette bruine labels (orderlijst, facturen), kaarten op mobiel |
| 34 | Alleen vragen indien nodig | lopend | |
| 35 | Aanvullende specificaties | deels | §35.0 (UI alleen Nederlands, `src/lib/i18n/nl.ts`), §35.2, §35.3 (P2a), §35.4, §35.6, §35.14 klaar; P3-A: §35.7 klantkant (orders lezen/wijzigen, annulering aanvragen, documenten, statussen per fase), §35.8 US-adreskaart en `service_rates.enabled` in het wijzigformulier, §35.10 factuurbadges en saldo per valuta; P3-B: §35.7 klant-INSERT (alleen klant-bewerkbare kolommen + `customer_id` uit de database + `parent_order_id`), §35.8 `service_rates.enabled` in het aanmeldformulier en `max_open_orders_per_customer` (fout 54000 netjes getoond), §35.14 verplicht vinkje verboden goederen; overige subsecties in latere fasen |

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
  getoond. Hetzelfde geldt voor `requireStaff`/`requireAdmin` (P2b): de 403/42501 bereikt de
  browser niet; P5 moet daar, net als `registerOrderFn`, fouten als data teruggeven.
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
