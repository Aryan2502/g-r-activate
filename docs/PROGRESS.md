# G&R Activate — Voortgang

Bron: `docs/SPEC.md` (§1–§35). §35 gaat voor bij verschillen.

## Status per sectie

| § | Onderwerp | Status | Bewijs |
|---|---|---|---|
| 1 | Bestaand project inspecteren | niet gestart | |
| 2 | Branding & design | niet gestart | |
| 3 | Bedrijfsdoel | niet gestart | |
| 4 | Klantaccount & GR-code | niet gestart | |
| 5 | Uitnodigingen / bestaande klanten | niet gestart | |
| 6 | Authenticatie | niet gestart | |
| 7 | Homepage | niet gestart | |
| 8 | Klantdashboard | niet gestart | |
| 9 | Order aanmelden | niet gestart | |
| 10 | Orderdetail | niet gestart | |
| 11 | Statusbeheer | niet gestart | |
| 12 | Admin-dashboard | niet gestart | |
| 13 | Klantbeheer | niet gestart | |
| 14 | Factuur genereren | niet gestart | |
| 15 | Live factuurvoorbeeld | niet gestart | |
| 16 | Factuuropslag | niet gestart | |
| 17 | Factuurstatus | niet gestart | |
| 18 | Factuurpagina klant | niet gestart | |
| 19 | Betalingsherinneringen | niet gestart | |
| 20 | Klanthistorie | niet gestart | |
| 21 | Admin order-/zendingbeheer | niet gestart | |
| 22 | Databaseontwerp | niet gestart | |
| 23 | Row Level Security | niet gestart | |
| 24 | E-mailsysteem | niet gestart | |
| 25 | Responsive design | niet gestart | |
| 26 | UX-eisen | niet gestart | |
| 27 | Beveiliging | niet gestart | |
| 28 | Audit trail | niet gestart | |
| 29 | Foutafhandeling | niet gestart | |
| 30 | Geen statische demo | niet gestart | |
| 31 | End-to-end acceptatietest | niet gestart | |
| 32 | Ontwikkelaanpak | niet gestart | |
| 33 | Ontwerpprincipe | niet gestart | |
| 34 | Alleen vragen indien nodig | niet gestart | |
| 35 | Aanvullende specificaties | niet gestart | |

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

_(leeg)_

## Later (buiten scope v1, §35.16)

- Uploaden van betaalbewijs door klanten
- Barcode-ontvangstscherm en register van onbekende pakketten
- Automatische opslag te late betaling
- In-app notificatie-inbox en orderchat
- Captcha en IP-rate-limit-tabellen
- Engelse UI
- Meerdere logins per zakelijke klant
- Online kaartbetalingen
