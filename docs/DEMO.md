# G&R Activate — demo accounts

Four ready-made logins with demo data, to click through the whole app before real
customers are added. Passwords are generated inside your database when you run the script
and shown only to you; they are never stored in this (public) repository.

| Role       | E-mail address                | What you see                                                 |
| ---------- | ----------------------------- | ------------------------------------------------------------ |
| beheerder  | `demo.beheerder@example.com`  | `/admin` with everything, incl. Team, Settings and Audit log |
| medewerker | `demo.medewerker@example.com` | `/admin` for daily work (no admin rights)                    |
| klant      | `demo.klant@example.com`      | `/portal` with 4 orders and 2 invoices (1 open, 1 paid)      |
| zakelijk   | `demo.zakelijk@example.com`   | `/portal` of "Demo Bedrijf N.V." with a B2B order at customs |

No e-mail is ever sent to these addresses (`example.com` does not receive mail).

## Create

1. Supabase → **SQL Editor** → **New query**.
2. Paste the whole content of
   [`supabase/demo/create_demo_accounts.sql`](../supabase/demo/create_demo_accounts.sql)
   and click **Run**.
3. The result table shows the four e-mail addresses with their passwords. Copy them
   somewhere safe (a password manager); they are not shown again.
4. Open the app (Lovable preview or your Vercel address) → **Inloggen**.

Lost the passwords? Run the same script again: the accounts get new passwords; the demo
data is not duplicated.

The demo data: Demo Klant has a registered order, one in transit, one ready for pickup
with an open invoice, and one picked up with a paid invoice. Demo Bedrijf N.V. has a B2B
order at customs. Everything else (inviting customers, receiving packages, making
invoices) you can try yourself with these accounts.

Before the demo invoice looks like the real thing, fill in your bank accounts, US
address and rates under `/admin/instellingen` (the demo invoices are issued with the
settings that exist at that moment).

## Remove

Run [`supabase/demo/remove_demo_accounts.sql`](../supabase/demo/remove_demo_accounts.sql)
the same way. It removes the four logins and everything linked to the two demo customers,
and nothing else. The pre-go-live reset (`docs/DEPLOYMENT.md` §8.2) also removes the demo
customers, but keeps the two demo team logins: run the remove script for those.

Note: demo invoices use invoice numbers (INV-<year>-0001, …). After removing them, set the
invoice counter under `/admin/instellingen` → Nummering, or run the reset, so real
invoices start where you want.

## Tested

Both scripts were run as the `postgres` role on a local Supabase stack with all
migrations: the four logins sign in through Supabase Auth, each sees only what its role
allows, a second run only changes the passwords, and the remove script leaves no demo
login or data behind. `supabase/tests/pglite/demo_accounts.test.ts` repeats this in CI.
