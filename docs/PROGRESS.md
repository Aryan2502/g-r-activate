# G&R Activate — Voortgang

Bron: `docs/SPEC.md` (§1–§35). §35 gaat voor bij verschillen.

## Status per sectie

Laatst bijgewerkt: einde P2b (2026-10-06). P2a = databasefundament (3 migraties, commit
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
| 8 | Klantdashboard | deels (P2b) | `/portal`: naam + GR-code (kopiëren), `/portal/profiel`: contactgegevens via `update_my_contact`, wachtwoord wijzigen; orders/facturen P3/P7 |
| 9–11 | Order aanmelden, detail, statusbeheer | niet gestart | P3/P4 |
| 12 | Admin-dashboard | deels (P2b) | `/admin`: wie is ingelogd + rol, klantentellingen (`customers`), open taken (`staff_tasks`); rest P5 |
| 13–21 | Klantbeheer t/m order-/zendingbeheer | niet gestart | P4–P9 (database staat er, P2a) |
| 22 | Databaseontwerp | klaar (P2a) | `supabase/migrations/*.sql` (3 bestanden), `m1/m2/m3_*.test.ts` in PGlite |
| 23 | Row Level Security | klaar in DB (P2a) | RLS + grants per tabel, PGlite-tests; live RLS-tests P10 |
| 24 | E-mailsysteem | deels | auth-templates (P2b); Resend/herinneringen P8 |
| 25 | Responsive design | basis (P2b) | publieke, auth-, portal- en admin-layouts gecontroleerd op 320–1440 px zonder horizontale scroll; eindronde P10 |
| 26 | UX-eisen | deels (P2b) | alle fouten bij eerste verzending zichtbaar, inline loginfouten, laad-/fout-/leegstaten, toasts |
| 27 | Beveiliging | deels (P2b) | geen geheimen in code (`server-boundary.test.ts`), `frame-ancestors`/nosniff/referrer-policy (`security-headers.test.ts`), adres-enumeratie verborgen op reset/resend |
| 28 | Audit trail | deels | audit-triggers in DB (P2a); weergave P9 |
| 29 | Foutafhandeling | deels (P2b) | `src/lib/errors.ts` (Postgres/PostgREST → Nederlands), `auth-errors.ts`, 404- en foutpagina, Nederlandse toasts |
| 30 | Geen statische demo | ok (P2b) | geen placeholder-cijfers of "binnenkort"; alles uit Supabase |
| 31 | End-to-end acceptatietest | niet gestart | P10 |
| 32 | Ontwikkelaanpak | lopend | fasen volgens §35.1 |
| 33 | Ontwerpprincipe | ok (P2b) | geen gradients/glas/paars; tabellen volgen in P3+ |
| 34 | Alleen vragen indien nodig | lopend | |
| 35 | Aanvullende specificaties | deels | §35.0 (UI alleen Nederlands, `src/lib/i18n/nl.ts`), §35.2, §35.3 (P2a), §35.4, §35.6, §35.14 klaar; overige subsecties in latere fasen |

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
| Betekenis `purchase_mode` ('customer_purchased','gr_purchases') bij B2B | klant koopt zelf / G&R koopt in namens klant |
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
