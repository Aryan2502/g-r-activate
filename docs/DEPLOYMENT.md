# G&R Activate — Deployment

How G&R Activate is hosted and configured, and what the owner does once before going
live (SPEC §35.15). Every SQL block that is marked as tested runs unchanged in the
database tests (`supabase/tests/pglite/*`).

## Go-live checklist

Work from top to bottom; each line points to the section with the exact steps. Tick a line
only when its check passes.

- [ ] **Plans** (§9): Supabase project on **Pro**; Vercel project in a **Pro** team (Hobby
      is for non-commercial use only).
- [ ] **Vercel** (§1): import the repository; Node.js **22.x**; region **iad1**; Fluid
      compute on with Max Duration ≥ 90 s; preview protection on; every environment
      variable of §1.2 set (secrets marked _Sensitive_); custom domain added, and `APP_URL`
      = `https://<prod-domain>`. Check: `https://<prod-domain>/` shows the homepage.
- [ ] **Supabase Auth** (§3): Site URL and the **exact** redirect hosts (no `*` in a
      host); _Confirm email_ ON; minimum password length 8; CAPTCHA off.
- [ ] **First admin** (§4): sign up, run the SQL, land on `/admin`.
- [ ] **Migrations** (§2.1): the migrations workflow is green for the newest commit and
      `supabase_migrations.schema_migrations` lists all eight files (the newest
      `20261008120000 | p10_review_hardening`).
- [ ] **Settings** (`/admin/instellingen`): company details, the three bank accounts, the
      US warehouse address, rates per lb, pickup hours, terms and prohibited goods. Leave
      the numbering (invoice counter, next customer code) for after the reset: the reset
      puts both back. Check: the dashboard's "Nog in te stellen" list is empty.
- [ ] **E-mail** (§5, §6): Resend domain verified; `RESEND_API_KEY`, `EMAIL_FROM`,
      `EMAIL_REPLY_TO` in Vercel; Resend as custom SMTP in Supabase Auth; the three auth
      templates pasted. Check: Systeemstatus shows the e-mail provider as set, and an
      invitation to your own address arrives (`email_logs` row `sent`).
- [ ] **Daily reminders** (§7): `CRON_SECRET` in Vercel; Vault secrets `app_url` and
      `cron_secret`; the curl test answers 200; Data API exposes only `public` and
      `graphql_public`.
- [ ] **RLS check** (§8.1): `supabase/tests/rls_checks.sql` in the SQL editor ends with
      `ALLE RLS-CONTROLES GESLAAGD`.
- [ ] **Acceptance walkthrough** (`docs/ACCEPTANCE.md`) on the production domain, every
      step marked "eigenaar test live" ticked.
- [ ] **Pre-go-live reset** (§8.2): test customers, orders, invoices, payments, e-mails and
      their audit rows removed; numbering restarted; the order-documents bucket emptied.
- [ ] **Numbering, after the reset** (`/admin/instellingen` → Nummering): set this year's
      invoice counter if G&R continues its own invoice numbers, and the **Volgende
      klantcode** if G&R keeps a range of codes free. Check: "De volgende factuur krijgt
      INV-…" shows the number G&R expects (the reset alone gives INV-<year>-0001 and
      GR00100).
- [ ] **Repository** (§2.3): repository private; a commit made by a bot (the types commit
      of the migrations workflow, or a Lovable edit) still deploys on Vercel.
- [ ] **Go**: public sign-up switched on or off as G&R wants (§3.2), and the first real
      customers invited from `/admin/klanten`.

| Part                            | Where                                                                            |
| ------------------------------- | -------------------------------------------------------------------------------- |
| Hosting (production + previews) | Vercel, auto-deployed from the GitHub repository                                 |
| Database, Auth, Storage         | Supabase project `blbazidqlesjokshfhiy` (us-east-1)                              |
| Database migrations             | GitHub Action `.github/workflows/supabase-migrations.yml`                        |
| Editor and preview              | Lovable (`https://id-preview--4938b866-9daa-485b-bc62-a0de41fd8eaa.lovable.app`) |

Placeholders used below — replace them with the real values:

- `<prod-domain>`: the production host name, e.g. `portal.example.com` (no `https://`, no trailing slash).
- `<vercel-team-slug>`: the Vercel team or account slug that appears at the end of preview URLs.
- `<ADMIN_EMAIL>`: the email address of the first administrator.

---

## 1. Vercel

### 1.1 Import the project

1. Vercel → **Add New… → Project** → import the GitHub repository.
2. Framework preset: **Other** (or whatever Vercel detects). Leave the build, install and
   output settings at their defaults: the build (`vite build` with the nitro Vercel preset)
   writes `.vercel/output`, which Vercel picks up by itself. Do not add a `vercel.json`.
3. **Settings → Build and Deployment → Node.js Version: 22.x.**
4. **Settings → Functions → Function Region: Washington, D.C., USA (`iad1`)** — next to
   the Supabase project in us-east-1, so every database call stays in the same region.
   On the same page: **Fluid compute: on** (the default for new projects) and **Function
   Max Duration: at least 90 seconds** (the Fluid default of 300 s is fine). The daily
   payment-reminder run (§7) works for up to 45 seconds plus one e-mail's 15-second timeout
   and then cleans up orphaned uploads; without Fluid compute the limit is 10 s (Hobby) or
   15 s (Pro) and a run with more than a handful of reminders is cut off. A run cut off
   anyway is shown as "Afgebroken" and closed by the next run; what it did not reach is
   picked up the next day.
5. **Settings → Deployment Protection:** keep _Vercel Authentication_ on for preview
   deployments, so previews are not public.
6. **Settings → Domains:** add `<prod-domain>`.

A local check of the same build: `VERCEL=1 bun run build` must produce `.vercel/output`.

### 1.2 Environment variables

Settings → Environment Variables. Mark every **secret** as _Sensitive_. Names are also
listed in `.env.example`. The committed `.env` holds only public values; never put a
secret there, in code, or behind a `VITE_` prefix (those are bundled into the browser).

| Variable                        | Value                                                                | Secret? | Environments                                                                 |
| ------------------------------- | -------------------------------------------------------------------- | ------- | ---------------------------------------------------------------------------- |
| `VITE_SUPABASE_URL`             | `https://blbazidqlesjokshfhiy.supabase.co`                           | no      | all                                                                          |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Supabase → Project Settings → API Keys → publishable / `anon` key    | no      | all                                                                          |
| `VITE_SUPABASE_PROJECT_ID`      | `blbazidqlesjokshfhiy`                                               | no      | all                                                                          |
| `SUPABASE_URL`                  | same as `VITE_SUPABASE_URL`                                          | no      | all                                                                          |
| `SUPABASE_PUBLISHABLE_KEY`      | same as `VITE_SUPABASE_PUBLISHABLE_KEY`                              | no      | all                                                                          |
| `SUPABASE_SERVICE_ROLE_KEY`     | Supabase → Project Settings → API Keys → `service_role` / secret key | **yes** | Production (and Preview / Lovable when they must test the P5 features below) |
| `CRON_SECRET`                   | random, at least 32 characters: `openssl rand -hex 32`               | **yes** | Production                                                                   |
| `APP_URL`                       | `https://<prod-domain>`                                              | no      | Production                                                                   |
| `RESEND_API_KEY`                | Resend API key (optional, see §6)                                    | **yes** | Production                                                                   |
| `EMAIL_FROM`                    | e.g. `G&R Solutions <noreply@<mail-domain>>` (optional)              | no      | Production                                                                   |
| `EMAIL_REPLY_TO`                | e.g. `info@grsolutions.sr` (optional)                                | no      | Production                                                                   |

Notes:

- `APP_URL` is the base of every link in emails and invitations. Without it the server
  falls back to `https://$VERCEL_PROJECT_PRODUCTION_URL` (set by Vercel), so preview
  deployments also send production links. Links in emails are never built from the
  request's Host header (SPEC §35.2). One exception, for links that are only **shown to
  staff on screen** (an invitation link or a password-reset link to copy or share via
  WhatsApp): when neither variable is set (the Lovable preview), the server uses the
  origin of the staff member's own browser, and the dialog says so ("APP_URL is niet
  ingesteld: …"). Set `APP_URL` in every environment where real invitations are made.
- `SUPABASE_SERVICE_ROLE_KEY` (since P5; more uses since P8) is required for the parts below. "Klant
  uitnodigen" and "Opnieuw versturen" themselves do NOT use it: the invitation row (only
  the token's SHA-256) is written with the staff member's own session (RLS). Without the
  key staff can therefore still make invitation links, but the invitee cannot use them.
  - **The public `/invite/<token>` page**: looking the invitation up by the hash of its
    token and redeeming it (creating or confirming the login) use the service role, only
    after the token's format is checked and hashed. Without the key the page says
    "Uitnodigingen kunnen op dit moment niet worden verwerkt".
  - **Deactiveren / Activeren** (admin): the login is banned or unbanned with
    `auth.admin.updateUserById(…, { ban_duration })`. Without the key the status still
    changes in the database, and the toast says the login did not change. A login that
    also belongs to the team (staff or admin, also a deactivated one, also your own) is
    never banned or unbanned from a customer page: only the customer record changes, and
    the toast points to `/admin/team` (which keeps one admin who can sign in and logs it).
  - **Wachtwoord-resetlink maken**: `auth.admin.generateLink({ type: "recovery" })`, for
    customers on their page, and for team members (admins only, never for a deactivated
    member) on `/admin/team` only.
  - **Team → Deactiveren / Activeren** (admin, `/admin/team`): bans or unbans the staff
    member's login with `ban_duration`, then writes the audit entry with the admin's own
    session. Without the key nothing changes and the dialog says so.

  - **Every e-mail the app sends (P8)**: `sendEmail` claims and records each e-mail in
    `public.email_logs` with the service role (bookkeeping only; the content is read with
    the session of whoever acted). Without the key no e-mail is sent at all: with Resend
    configured each one fails with "E-maillog niet beschikbaar (service role)"; without
    Resend nothing is logged either (no `skipped_no_provider` rows).
  - **Payment reminders (P8)**: "Herinneringen nu versturen", "Herinnering nu versturen"
    and the daily run (`/api/cron/payment-reminders`, after its `CRON_SECRET` check) read
    the open invoices and write `job_runs`, `email_logs` and the invoices' reminder columns
    with the service role. Without the key the buttons say the service key is missing and
    the daily run answers 500.
  - **Orphaned uploads (P8)**: the same daily run removes files in `order-documents` older
    than 24 hours that never got an `order_documents` row, through the Storage API.

  Inviting staff (`/admin/team` → "Medewerker uitnodigen"), changing roles and every
  setting on `/admin/instellingen` use the admin's own session (RLS), not the key.

  The key is read only in `src/server/*` (`admin-client.ts`, loaded with a dynamic import
  inside server-function handlers); `server-boundary.test.ts` fails the test suite
  if it appears anywhere else.

- The admin dashboard's **Systeemstatus** panel shows, for admins, whether
  `SUPABASE_SERVICE_ROLE_KEY`, `APP_URL` (or the Vercel production domain as fallback),
  e-mail (`RESEND_API_KEY` + `EMAIL_FROM`) and `CRON_SECRET` are set, as yes/no only (never a
  value), plus the last payment-reminder run and, on its own line, the last AUTOMATIC run
  (a manual "Herinneringen nu versturen" must not hide a daily schedule that stopped:
  without an automatic run for 26 hours the panel and the checklist warn). The "Nog in te stellen" checklist above it
  lists the same server items together with missing settings (bank accounts, US address,
  rates, pickup hours, terms). Check it after every change of variables and redeploy.
- Each server variable is checked only when code first needs it: a missing
  `CRON_SECRET` breaks only `/api/cron/*`; a missing `RESEND_API_KEY`/`EMAIL_FROM` turns
  email into a `skipped_no_provider` log entry instead of an error.
- After changing variables, redeploy (Deployments → … → Redeploy) for them to apply.

### 1.3 Lovable preview

The Lovable preview runs the same code against the same Supabase project. Browser-side
features (sign-in, portal, admin) work there without extra configuration. Server
functions added in later phases need the server variables above in the preview's
environment as well; add only the public ones unless a feature under test needs a secret.
Never enable Lovable Cloud, Lovable Emails or a Lovable database (SPEC §35.2).

To test invitations, `/invite/<token>`, deactivating customers or reset links in the
preview, add `SUPABASE_SERVICE_ROLE_KEY` as a secret there (it is the same project, so the
preview acts on real logins). Without `APP_URL` the links shown on screen use the
preview's own address.

---

## 2. GitHub Actions

### 2.1 Database migrations

Already set up (`.github/workflows/supabase-migrations.yml`). On every push to `main` that
touches `supabase/migrations/**`, the workflow applies new migrations with
`supabase db push` and commits regenerated types to
`src/integrations/supabase/types.ts`. Repository secrets (Settings → Secrets and
variables → Actions), both already set:

| Secret                  | Value                                                               |
| ----------------------- | ------------------------------------------------------------------- |
| `SUPABASE_ACCESS_TOKEN` | personal access token of the Supabase account that owns the project |
| `SUPABASE_DB_PASSWORD`  | database password of the project                                    |

Applied migrations are never edited; every change is a new file (SPEC §35.3).

**Applied so far.** The first seven migrations in `supabase/migrations/` have been applied
to the project by the workflow: the three P2a foundation files,
`20261007090000_order_hardening.sql`, `20261007120000_p4_order_guards.sql`,
`20261007150000_p5_customers.sql` and `20261008090000_p8_reminders.sql`. The eighth,
`20261008120000_p10_review_hardening.sql` (P10 review: upload limits per customer,
`has_role()` answers customers only about themselves, the audit row for password-reset
links, internal notes in the audit log), is applied by the workflow when it reaches
`main`; nobody has run it against the project yet. Check in the SQL editor (eight rows,
the newest `20261008120000 | p10_review_hardening`):

```sql
select version, name from supabase_migrations.schema_migrations order by version;
```

The app works before and after that migration is applied (a password-reset link made
before it writes the internal note first instead of the audit row). After any new
migration: let the workflow run, check the row appears, then run
`supabase/tests/rls_checks.sql` again (§8.1).

### 2.2 Continuous integration

`.github/workflows/ci.yml` runs on every push and pull request: `bun install
--frozen-lockfile`, `bunx tsc --noEmit`, `bun run test` (unit tests and the PGlite
database tests, including the RLS script) and `bun run build`. It needs no secrets: the
committed `.env` holds only public values. On a private repository these runs use the
account's GitHub Actions minutes (a run takes about five minutes on GitHub's runners).

Two things CI does not do:

- **It does not run on the "Regenerate Supabase types" commit.** GitHub starts no
  workflow for a push made with the workflow's own token. That is why the migrations
  workflow type-checks the app itself, right after pushing the new types (step "Type
  check with the new types"). A red migrations run therefore means: the database and the
  code no longer fit; fix the code before relying on that deployment.
- **It does not stop Vercel.** Vercel deploys every push to `main` (also Lovable edits
  and the types commit) whether CI is green or not; `vite build` does not type-check.
  A red CI run on `main` means: fix it, and if the deployed app misbehaves, roll back in
  Vercel → Deployments → the last good deployment → **Instant Rollback**. If you want
  Vercel to wait for CI, look in Vercel → Project → Settings for deployment checks on
  your plan and require the "CI / check" GitHub check; that was not set up or tested
  here.

### 2.3 Making the repository private

The repository and the committed `.env` were written to be safe in public (no secrets),
but nothing requires that. Before go-live:

1. GitHub → repository → Settings → General → Danger Zone → **Change visibility →
   Private**. The migrations workflow and its secrets keep working.
2. Vercel deploys commits from a private repository only for commit authors it accepts.
   Commits on `main` come from people and from bots: the "Regenerate Supabase types"
   commit of the migrations workflow is authored by `github-actions[bot]`, and edits made
   in Lovable arrive through Lovable's GitHub app. After the switch, check one deployment
   of each kind: Vercel → Deployments, the deployment must show that commit with status
   **Ready**. If Vercel shows it as **Blocked** (the commit author is not a member of the
   team), choose one:
   - redeploy it by hand (Deployments → … → Redeploy); or
   - Vercel → Settings → Git → **Deploy Hooks**: create a hook for `main`, store its URL as
     the repository secret `VERCEL_DEPLOY_HOOK`, and add a step at the end of the
     migrations workflow that calls it (`curl -fsS -X POST "$VERCEL_DEPLOY_HOOK"`), so the
     types commit always deploys.

   This check was not possible from here (no Vercel project exists yet); do it once.

---

## 3. Supabase Auth settings

### 3.1 URL configuration (Authentication → URL Configuration)

**Site URL:** `https://<prod-domain>`

The Site URL is `{{ .SiteURL }}` in the email templates (§5), so confirmation and
password links always point at production.

**Redirect URLs** — add exactly these, and nothing with a `*` in the host:

```text
https://<prod-domain>/**
https://id-preview--4938b866-9daa-485b-bc62-a0de41fd8eaa.lovable.app/**
http://localhost:8080/**
https://g-r-activate-git-main-<vercel-team-slug>.vercel.app/**
```

- The last line is the fixed alias of the `main` branch on Vercel. Add the alias of any
  other long-lived branch the same way (`g-r-activate-git-<branch>-<vercel-team-slug>.vercel.app`);
  if the Vercel project has another name, use that name instead of `g-r-activate`.
- Per-commit preview URLs (`g-r-activate-<hash>-<team>.vercel.app`) are deliberately
  **not** listed: a pattern such as `g-r-activate-*-<team>.vercel.app` would also match
  hosts that other people can create on `vercel.app`, and every allow-listed host
  receives sign-in tokens. Email links requested from such a preview fall back to the
  Site URL (production).
- **Never** add `https://*.lovable.app/**` or `https://*.vercel.app/**` (SPEC §35.15).
- The app sends `window.location.origin + "/auth/confirm"` as the redirect for sign-up
  and password reset. A host that is not on this list silently falls back to the Site
  URL; the app then still handles the link (a recovery link opens the
  set-password page), but on the production domain.

### 3.2 "Confirm email" must stay ON

Authentication → Sign In / Providers → Email → **Confirm email: ON**. This is a hard
requirement:

- Without it, anyone can register with somebody else's address and immediately get a
  portal account and a GR customer code for it. The real owner of that address is then
  blocked: the address is taken in `customers` (one record per email).
- The sign-up trigger creates a customer record — and uses up a GR number — only once the
  address is confirmed, so bot sign-ups cost nothing (SPEC §35.6).

Also keep **Secure email change** ON.

Until custom SMTP is configured (§6), Supabase's built-in mailer only delivers to members
of the owner's Supabase organisation, with a very low hourly limit. Public sign-up
therefore only works for real customers once Resend SMTP is set up; invitations do not
depend on it (their links can always be copied). A customer who registers before then
sees "Registreren via e-mail is tijdelijk niet mogelijk. Neem contact op met G&R
Solutions." Recommended: once the first administrator exists (§4), switch public sign-up
off until SMTP works, and back on afterwards (Supabase → SQL Editor):

<!-- signup-switch-sql:start (tested by supabase/tests/pglite/deployment.test.ts) -->

```sql
update public.company_settings set public_signup_enabled = false where id;  -- later: true
```

<!-- signup-switch-sql:end -->

With the switch off, `/registreren` explains that accounts are created by invitation, and
the homepage and header hide "Account aanmaken".

### 3.3 Passwords

Authentication → Sign In / Providers → Email:

- **Minimum password length: 8** (the app enforces the same minimum).
- Password requirements: no additional character classes needed.
- On the Pro plan, also turn on **Leaked password protection**.

### 3.4 Attack protection (CAPTCHA): leave it off

Authentication → Attack Protection → **Enable CAPTCHA protection: OFF** for v1. The app
does not send a CAPTCHA token, so turning it on breaks sign-in, sign-up and password
reset (CAPTCHA is listed under "Later", SPEC §35.16).

Known limitation: Supabase Auth applies a per-address limit (one mail per 60 seconds) to
password-reset and confirmation mails, and only for addresses that have an account. The
app hides this — it shows the same "Controleer uw inbox" screen either way (SPEC §35.6) —
but someone calling the Supabase Auth API directly with the public key can still tell
from that limit whether an address is registered. CAPTCHA (with app support) is the only
way to reduce this at the API level.

### 3.5 Security headers

Every page the server renders sends `Content-Security-Policy: frame-ancestors 'self'
https://lovable.dev https://*.lovable.dev https://gptengineer.app https://*.gptengineer.app`
(so no other site can embed the app and clickjack it), `X-Content-Type-Options: nosniff`
and `Referrer-Policy: strict-origin-when-cross-origin` (`src/lib/security-headers.ts`,
set on the root route). Nothing to configure in Vercel.

---

## 4. First administrator (one time)

There is no in-app way to become admin (SPEC §35.4). After deploying:

1. Open `https://<prod-domain>/registreren` and create an account with `<ADMIN_EMAIL>`.
   (As a member of the Supabase organisation, you receive the confirmation mail even
   before SMTP is set up.) Confirm the address. This also creates a customer record for
   that login, which the SQL below takes back.
2. Supabase → **SQL Editor** → new query → paste the SQL below, replace `<ADMIN_EMAIL>`
   (twice) with the address from step 1, and run it.
3. Reload the app: you land on `/admin`.

The SQL grants the `admin` role, then unlinks the customer record the sign-up created
and marks it disabled (`disabled_reason = 'bootstrap admin'`) — only if it has no orders
and no invoices. A record with orders or invoices stays linked to your login; you may
deactivate it on its customer page later: that changes only the customer record, never
your admin login. It never deletes the record, so its GR number is never reused. It is safe
to run more than once; the `do` block runs as one transaction, so an error changes
nothing. If it is run before the address is confirmed, no customer record is created at all.

<!-- first-admin-sql:start (tested by supabase/tests/pglite/deployment.test.ts) -->

```sql
do $$
declare
  _email constant text := lower(btrim('<ADMIN_EMAIL>'));
  _user_id uuid;
  _customer public.customers;
begin
  select u.id into _user_id from auth.users u where lower(u.email) = _email;
  if _user_id is null then
    raise exception 'Geen account gevonden voor %: registreer eerst via /registreren.', _email;
  end if;

  insert into public.user_roles (user_id, role)
  values (_user_id, 'admin')
  on conflict (user_id, role) do nothing;

  -- An admin is not a customer: unlink the record the sign-up created, keep its number.
  select * into _customer from public.customers c where c.user_id = _user_id for update;
  if found then
    if exists (select 1 from public.orders o where o.customer_id = _customer.id)
       or exists (select 1 from public.invoices i where i.customer_id = _customer.id) then
      raise notice 'Klantdossier % heeft orders of facturen en blijft gekoppeld.', _customer.customer_code;
    else
      update public.customers c
         set user_id = null, status = 'disabled', disabled_reason = 'bootstrap admin'
       where c.id = _customer.id;
    end if;
  end if;
end
$$;

-- Result: roles should be {admin}; linked_customer empty unless it has orders/invoices.
select u.email,
       array(select r.role::text from public.user_roles r where r.user_id = u.id order by 1) as roles,
       (select string_agg(c.customer_code || ' (' || c.status || ')', ', ')
          from public.customers c where c.user_id = u.id) as linked_customer
from auth.users u
where lower(u.email) = lower(btrim('<ADMIN_EMAIL>'));
```

<!-- first-admin-sql:end -->

Further staff and admins are invited from `/admin/team`, not with SQL: "Medewerker
uitnodigen" makes a personal link (copy or WhatsApp; also e-mailed once §6 is done) with which the person
chooses a password and their name, and lands on `/admin`. On the same page an admin changes
roles (the database always keeps one admin who can sign in) and deactivates a login that
should no longer work (a reason is required and logged; the role is kept, so the login can be
activated again). Settings, bank accounts, the US warehouse address and rates are filled in on
`/admin/instellingen`; the dashboard's "Nog in te stellen" list shows what is still missing.

---

## 5. Auth email templates

Branded Dutch templates live in `supabase/templates/`. Their links go to
`{{ .SiteURL }}/auth/confirm?token_hash=…&type=…`, where the visitor clicks
"Doorgaan" before the token is used, so mail scanners that open links cannot use them up.

Supabase → Authentication → Emails → Templates. For each template, set the subject and
paste the whole file as the body:

| Supabase template | File                                     | Subject                                    |
| ----------------- | ---------------------------------------- | ------------------------------------------ |
| Confirm signup    | `supabase/templates/confirm_signup.html` | Bevestig uw e-mailadres – G&R Solutions    |
| Reset password    | `supabase/templates/recovery.html`       | Nieuw wachtwoord instellen – G&R Solutions |
| Magic link        | `supabase/templates/magic_link.html`     | Inloggen bij G&R Activate                  |

The logo is loaded from `{{ .SiteURL }}/brand/gr-logo-banner.jpg`, so the Site URL must be
the live production domain. Until the templates are pasted, Supabase's default links still
work: they arrive on `/auth/confirm` already verified and the app handles them.

Final check once Resend SMTP is active (§6.3): register a test account on `/registreren`
with an address outside the Supabase organisation and request a password reset on
`/wachtwoord-vergeten`. Both mails must arrive with the logo, from your `EMAIL_FROM`
address, and their buttons must open `https://<prod-domain>/auth/confirm?…`.

---

## 6. Email via Resend

The app sends its own e-mails through Resend's REST API (SPEC §35.12): invitations,
welcome, order confirmation, status updates, invoices, payment reminders and payment
confirmations, always in Dutch with the G&R logo (`https://<prod-domain>/brand/gr-logo-banner.jpg`,
so `APP_URL` must be the production domain). Supabase Auth sends the sign-up and
password mails; with custom SMTP (§6.3) it sends them through Resend too.

Until §6.1–6.2 are done nothing is lost: every e-mail the app would send is written to
`public.email_logs` as `skipped_no_provider` (only when `SUPABASE_SERVICE_ROLE_KEY` is set,
§1.2: that log is written with the service role), staff screens say "E-mail is nog niet
geconfigureerd", and WhatsApp takes over: invitation and reset links can be copied or
shared, every invoice has "Deel via WhatsApp", `/admin/herinneringen` has "Herinner via
WhatsApp" on every open invoice, and after a status change the dialog lists the
customers who got no e-mail, each with a ready WhatsApp message.

### 6.1 Verify the sending domain in Resend

1. Create an account at resend.com (the free plan allows 100 mails a day, 3,000 a month,
   and a few requests per second; the app paces itself and retries once on a rate limit).
2. **Domains → Add domain.** Use a subdomain you control, e.g. `mail.grsolutions.sr`
   (`<mail-domain>` below), region **us-east-1**.
3. Add the DNS records Resend shows (an MX and a TXT/SPF record on `send.<mail-domain>`,
   the DKIM TXT record `resend._domainkey.<mail-domain>`) at the DNS provider of the domain.
   Recommended: a DMARC record `_dmarc.<mail-domain>` with `v=DMARC1; p=none;`.
4. Wait until the domain shows **Verified** (minutes to a few hours).
5. **API Keys → Create API key**: name `g-r-activate production`, permission **Sending
   access**, domain `<mail-domain>`. Copy the key (`re_…`); it is shown once.

### 6.2 Vercel environment variables (Production)

Settings → Environment Variables, environment **Production**, then redeploy:

| Variable         | Value                                                        | Secret?                  |
| ---------------- | ------------------------------------------------------------ | ------------------------ |
| `RESEND_API_KEY` | the key from §6.1 step 5                                     | **yes** (mark Sensitive) |
| `EMAIL_FROM`     | `G&R Solutions <noreply@<mail-domain>>` (a verified address) | no                       |
| `EMAIL_REPLY_TO` | `info@grsolutions.sr` (where customers' replies go)          | no                       |

- Without `EMAIL_REPLY_TO` replies go to the company e-mail on `/admin/instellingen`.
- Both `RESEND_API_KEY` and `EMAIL_FROM` are needed; with only one of them the app keeps
  logging `skipped_no_provider`.
- Leave them out of Preview and the Lovable preview unless you want those to send real
  mail to real customers (they share the production database).

Check: `/admin` → **Systeemstatus** shows "E-mailprovider (Resend): Ingesteld"; the
status-change dialog no longer says "E-mail is nog niet geconfigureerd". Then invite
yourself as a test customer (an address you own) and look at the log (SQL Editor):

```sql
select created_at, kind, status, recipient, error
from public.email_logs order by created_at desc limit 20;
```

`sent` means Resend accepted it (its id is in `provider_message_id`; Resend → Emails shows
delivery). `failed` holds Resend's reason in `error` (e.g. an unverified `EMAIL_FROM`
domain); the same e-mail is retried the next time the same event is sent (reminders: the
next daily run). The same key is never sent twice (`idempotency_key`, also passed to
Resend as `Idempotency-Key`).

### 6.3 Resend as custom SMTP for Supabase Auth

So that sign-up confirmations and password resets reach every customer (not only members
of the Supabase organisation):

1. Supabase → **Authentication → Emails → SMTP Settings** → **Enable custom SMTP**:

   | Field        | Value                                                                                                        |
   | ------------ | ------------------------------------------------------------------------------------------------------------ |
   | Sender email | `noreply@<mail-domain>` (same verified domain)                                                               |
   | Sender name  | `G&R Solutions`                                                                                              |
   | Host         | `smtp.resend.com`                                                                                            |
   | Port number  | `465`                                                                                                        |
   | Username     | `resend`                                                                                                     |
   | Password     | a Resend API key with sending access (§6.1 step 5; a separate key named `supabase-smtp` is easier to rotate) |

   Save.

2. **Authentication → Rate Limits → Rate limit for sending emails**: raise it from the
   built-in default to e.g. **30 per hour** (custom SMTP allows it).
3. Paste the branded templates (§5) if not done yet, and do the final check in §5.
4. Turn public sign-up back on if you switched it off in §3.2:
   `update public.company_settings set public_signup_enabled = true where id;`

## 7. Payment reminders: Vault secrets and the daily job

Migration `20261008090000_p8_reminders.sql` enables **pg_cron** and **pg_net** and
schedules one job, `gr-payment-reminders`, every day at **12:00 UTC (09:00 Suriname)**.
It calls `private.invoke_payment_reminders()`, which reads two secrets from Supabase
Vault and POSTs to `https://<prod-domain>/api/cron/payment-reminders` with
`Authorization: Bearer <cron_secret>`. Without both secrets it quietly does nothing. The
endpoint checks the secret against `CRON_SECRET`, sends the reminders that are due
(`runPaymentReminders`, recorded in `public.job_runs`) and removes uploads older than
24 hours that never got an `order_documents` row (via the Storage API). The same run
can be started by staff with **Herinneringen nu versturen** on `/admin/herinneringen`.

### 7.1 CRON_SECRET (Vercel)

Generate a long random value once, e.g. on your own computer:

```sh
openssl rand -hex 32
```

Vercel → Settings → Environment Variables → `CRON_SECRET` = that value, **Production**,
**Sensitive**; redeploy. The Systeemstatus panel then shows "Sleutel voor geplande taken
(CRON_SECRET): Ingesteld". Without it `/api/cron/payment-reminders` answers 500 and
nothing runs; a wrong token gets 401.

### 7.2 Vault secrets (Supabase)

Supabase → **SQL Editor** → new query. Replace both placeholders and run it once:
`<https://prod-domain>` is the production origin exactly as in `APP_URL` (with
`https://`, no trailing slash or path), and the second value is the **same value as
`CRON_SECRET`** in Vercel.

`app_url` must be the host that answers **without a redirect**. If Vercel redirects the
apex to `www` (or the other way round), use the host it redirects TO: pg_net follows the
redirect but drops the `Authorization` header on the way to the other host, so every
scheduled call would get 401 and no reminder would go out on its own. Check it before
creating the secret (no `-L`, so curl does not follow redirects):

```sh
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://<prod-domain>/api/cron/payment-reminders
```

`401` is right (the endpoint answered; no secret was sent; `500` while `CRON_SECRET` is
not set yet). `307` or `308` means this host redirects: use the other one.

<!-- vault-sql:start (tested by supabase/tests/pglite/p8_reminders.test.ts) -->

```sql
select vault.create_secret('<https://prod-domain>', 'app_url');
select vault.create_secret('<same value as CRON_SECRET>', 'cron_secret');
```

<!-- vault-sql:end -->

To change a value later (e.g. after rotating `CRON_SECRET`; update Vercel and Vault together):

```sql
select vault.update_secret(
  (select id from vault.secrets where name = 'cron_secret'),
  '<new CRON_SECRET>'
);
```

Check that both exist, without printing them:

```sql
select name, created_at, updated_at from vault.secrets where name in ('app_url', 'cron_secret');
```

### 7.3 Check the job and test the endpoint

The schedule (one row, `0 12 * * *`, active):

```sql
select jobname, schedule, active from cron.job;
```

Test the endpoint from your own computer (replace both values; never paste the secret
into a chat or ticket):

```sh
curl -i -X POST https://<prod-domain>/api/cron/payment-reminders \
  -H "Authorization: Bearer <CRON_SECRET>"
```

Expect `HTTP/2 200` and a JSON body with counts only, e.g.
`{"ok":true,"reminders":{"status":"succeeded","stats":{"checked":3,"sent":1,…}},"cleanup":{…}}`.
Without the header: `401`. A `307`/`308` means the host redirects (see §7.2). A run started
with curl counts as automatic: it appears on `/admin/herinneringen` under "Laatste rondes"
(automatisch) and in the Systeemstatus panel under "Laatste automatische ronde".

When the schedule never reaches the app (Vault secrets missing or different from
`CRON_SECRET`, an `app_url` that redirects), nothing is written to `job_runs`. The
Systeemstatus panel and the "Nog in te stellen" checklist then warn once no automatic run
has started for 26 hours (also when someone pressed "Herinneringen nu versturen" in the
meantime). pg_net keeps its answers for about 6 hours; look at them with the query below.

Test the database side the way pg_cron calls it (SQL Editor), then look at pg_net's answer
a few seconds later:

```sql
select private.invoke_payment_reminders();
select id, status_code, left(content, 300) as content, error_msg, created
from net._http_response order by created desc limit 1;
```

After the first scheduled run (12:00 UTC), pg_cron's own log:

```sql
select status, return_message, start_time
from cron.job_run_details order by start_time desc limit 5;
```

### 7.4 pg_net and the Data API

On Supabase, pg_net is installed and owned by `supabase_admin`; its functions stay
executable by `PUBLIC` (and Supabase grants `anon`/`authenticated` usage on schema `net`).
A migration cannot change that (it runs as the non-owner `postgres`), so the P8 migration
does not try. What keeps browsers from making the database send HTTP requests is that the
`net` schema is **not exposed** through the Data API: no API request can name
`net.http_post`, and no function an API role may call uses pg_net (only
`private.invoke_payment_reminders()`, which only pg_cron may run; tested in
`supabase/tests/pglite/p8_reminders.test.ts`).

Check once, and after any change to the API settings: Supabase → **Project Settings →
Data API → Exposed schemas** lists only `public` and `graphql_public`. Never add `net`,
`extensions`, `private`, `cron` or `vault` there.

## 8. Before go-live: RLS check and reset

### 8.1 RLS check

`supabase/tests/rls_checks.sql` proves in the live database that every customer sees and
changes only their own data (SPEC §35.15). It creates throwaway users (customers A and B,
a deactivated customer C, a customer D without login, a staff member and an admin, all
`rls-…@example.com`), acts as each of them exactly as the app does, tries everything that
must fail, and rolls everything back at the end: nothing is stored, not even a customer
number.

1. Supabase → **SQL Editor** → New query. Paste the **whole file** and press **Run**. The
   editor may warn about "destructive operations": that is expected (the script tries
   forbidden changes on purpose, and rolls back); choose to run it.
2. Good: one row, `ALLE RLS-CONTROLES GESLAAGD`.
3. Wrong: an error that starts with `RLS-CONTROLE MISLUKT [wie]: …`, naming who saw or
   changed what (for example `[klant A]: ziet orders van klant B`). Nothing is stored.
   Do not go live; send the message to whoever maintains the app. An error that does
   not start with `RLS-CONTROLE MISLUKT` means the test data could not be created (for
   example a migration that is not applied yet, §2.1). If the editor then says "current
   transaction is aborted", run `rollback;` once.

The script switches on air freight and raises "Maximaal aantal openstaande aanmeldingen
per klant" to at least 50 inside its own transaction (its test customers register a few
orders), so your settings do not get in its way and are unchanged afterwards.

The script expects every migration in `supabase/migrations/` to be applied (§2.1). On a
project without `20261008120000_p10_review_hardening.sql` it fails, correctly, with
`[klant A]: weet via has_role() welke login beheerder of medewerker is`.

Run it again after every new migration. The same file runs in the test suite
(`supabase/tests/pglite/rls_checks_script.test.ts`), also against deliberately broken
policies to prove it fails then.

### 8.2 Pre-go-live reset

Run this **once**, after the RLS check and the walkthrough of `docs/ACCEPTANCE.md`, and
**before** the first real customer is added or invited. It removes everything customers
and testing produced, and keeps how G&R is set up.

Removed:

- every customer record (also the disabled record of §4), order, document record, status
  history, shipment, invoice (also issued ones), invoice line, payment, internal note,
  staff task, customer invitation, e-mail log and job run, and the audit rows of all of
  these (also those of internal notes and of the password-reset links made while
  testing);
- every login without a team role: the test customers' logins and their profiles.

Kept: company settings, bank accounts, US warehouse addresses, rates, statuses, the team
(logins with a role, their profiles and roles, staff invitations) and the audit rows of
settings and team changes.

Numbering starts again: new customer codes from **GR00100** (numbers given up during
testing are forgotten; existing G&R customers keep their own GR000xx code when you add
or invite them), orders from **ORD-<year>-00001**, invoices from **INV-<year>-0001**. To
continue G&R's own invoice numbers, or to keep a range of customer codes free, set the
counter and the next customer code on `/admin/instellingen` → Nummering **after** the
reset (go-live checklist "Numbering, after the reset"); a value set before it is gone.

Do not run it once real customers are in the system: it removes every customer.

**Step 1 — uploaded files (Storage, not SQL).** Supabase refuses SQL deletes in its
storage tables, and SQL would leave the files themselves behind. Supabase → **Storage**
→ bucket `order-documents` → select every folder → **Delete**. (If you skip this, the
daily reminder run (§7) removes files older than 24 hours that no longer have a
document record, up to 500 per day.)

**Step 2 — look first.** SQL Editor, run (changes nothing; run it again after step 3 to
check the result):

<!-- reset-overview-sql:start (tested by supabase/tests/pglite/deployment_reset.test.ts) -->

```sql
select wat, aantal from (values
  (1, 'klantdossiers', (select count(*) from public.customers)),
  (2, 'logins zonder teamrol (testklanten)', (select count(*) from auth.users u
       where not exists (select 1 from public.user_roles r where r.user_id = u.id))),
  (3, 'orders', (select count(*) from public.orders)),
  (4, 'zendingen', (select count(*) from public.shipments)),
  (5, 'facturen', (select count(*) from public.invoices)),
  (6, 'betalingen', (select count(*) from public.payments)),
  (7, 'e-maillogs', (select count(*) from public.email_logs)),
  (8, 'auditregels', (select count(*) from public.audit_log)),
  (9, 'bestanden in order-documents (stap 1)', (select count(*) from storage.objects
       where bucket_id = 'order-documents')),
  (10, 'teamleden (blijven)', (select count(distinct user_id) from public.user_roles)),
  (11, 'volgend nieuw klantnummer', (select case when is_called then last_value + 1
       else last_value end from private.customer_number_seq))
) t(nr, wat, aantal)
order by nr;
```

<!-- reset-overview-sql:end -->

**Step 3 — reset.** Paste the SQL below, replace `<TYP HIER: WIS ALLE TESTGEGEVENS>` with
`WIS ALLE TESTGEGEVENS` (without `<` and `>`), and run it. It is one transaction: an error
changes nothing. It refuses to run without that phrase, and when no admin who can sign in
exists (§4). The guards that normally keep issued invoices and payments forever are
switched off only inside this transaction and on again before it ends.

<!-- reset-sql:start (tested by supabase/tests/pglite/deployment_reset.test.ts) -->

```sql
do $$
declare
  _bevestiging constant text := '<TYP HIER: WIS ALLE TESTGEGEVENS>';
  _klanten bigint;
  _logins bigint;
begin
  if _bevestiging <> 'WIS ALLE TESTGEGEVENS' then
    raise exception 'Niets gewist: vervang <TYP HIER: WIS ALLE TESTGEGEVENS> door WIS ALLE TESTGEGEVENS.';
  end if;
  if not exists (
    select 1 from public.user_roles r join auth.users u on u.id = r.user_id
    where r.role = 'admin' and (u.banned_until is null or u.banned_until <= now())
  ) then
    raise exception 'Niets gewist: er is geen beheerder die kan inloggen (DEPLOYMENT.md §4).';
  end if;

  -- Issued invoices and payments are never deleted, except here.
  alter table public.payments disable trigger payments_guard;
  alter table public.invoices disable trigger invoices_guard;
  alter table public.invoice_items disable trigger invoice_items_guard;

  delete from public.payments;
  update public.invoices set replaces_invoice_id = null where replaces_invoice_id is not null;
  delete from public.invoices;          -- and their lines
  delete from public.email_logs;
  delete from public.job_runs;
  delete from public.orders;            -- and their documents, status history, notes and tasks
  delete from public.shipments;
  delete from public.staff_tasks;
  delete from public.internal_notes;
  delete from public.invitations where kind = 'customer';
  select count(*) into _klanten from public.customers;
  delete from public.customers;
  -- Logins without a team role: the test customers (their profiles go with them).
  with weg as (
    delete from auth.users u
    where not exists (select 1 from public.user_roles r where r.user_id = u.id)
    returning 1
  )
  select count(*) into _logins from weg;

  alter table public.payments enable trigger payments_guard;
  alter table public.invoices enable trigger invoices_guard;
  alter table public.invoice_items enable trigger invoice_items_guard;

  -- Numbering starts again: GR00100, ORD-<year>-00001, INV-<year>-0001.
  delete from private.retired_customer_numbers;
  delete from private.order_reference_counters;
  delete from public.invoice_number_counters;
  perform setval('private.customer_number_seq', 100, false);

  -- Audit rows of what was removed; settings and team changes stay.
  delete from public.audit_log a
  where a.table_name not in ('company_settings', 'company_bank_accounts', 'warehouse_addresses',
                             'service_rates', 'shipment_statuses', 'user_roles', 'team_login')
    and not (a.table_name = 'invitations' and coalesce(a.new_data, a.old_data) ->> 'kind' = 'staff');

  raise notice 'Gewist: % klantdossiers en % logins zonder teamrol. Nieuwe klantcodes beginnen bij GR00100.',
    _klanten, _logins;
end
$$;
```

<!-- reset-sql:end -->

**Step 4 — check.** Run the query of step 2 again: everything is 0 except "teamleden
(blijven)", and "volgend nieuw klantnummer" is 100. Supabase → Authentication → Users
lists only the team. On `/admin` the dashboard shows no customers, orders or invoices,
`/admin/instellingen` still holds every setting, and `/admin/team` the whole team. The
Systeemstatus panel says no reminder run has happened yet until the next daily run
(12:00 UTC); that is expected.

---

## 9. Plans before go-live

Both free plans are fine for building and testing, not for a business that depends on the
portal.

**Supabase: Pro.** Supabase → Organization → Billing → upgrade the organisation that owns
`blbazidqlesjokshfhiy`.

- **Backups.** The Free plan has no daily backups; Pro keeps daily backups for 7 days
  (restore from Database → Backups). Point-in-time recovery is a paid add-on if G&R wants
  to restore to the minute.
- **No pausing.** Free projects are paused after a week without activity; a paused
  project means the portal, the invitation links and the daily reminders stop until
  someone restores it by hand.
- **Security and limits.** Leaked password protection (§3.3) is Pro only; Pro also has
  more database and storage space and higher Auth limits.

**Vercel: Pro.** Vercel's Hobby plan is for personal, non-commercial use only; a customer
portal of a company is commercial use. Create the project in a Pro team (or move it there:
Project → Settings → General → Transfer). Pro also gives the longer function limits the
daily reminder run needs (§1.1) without depending on Hobby's fair-use terms.

Prices change; check supabase.com/pricing and vercel.com/pricing before upgrading. When
these docs were written Supabase Pro started at about USD 25 per month per organisation
(compute credits included) and Vercel Pro at about USD 20 per team member per month.

---

## 10. Local development

```sh
bun install
bun run dev            # http://localhost:8080
bun run test           # unit tests + database tests (PGlite)
bun run test:db        # only the database tests (migrations, RLS script, SQL in these docs)
bunx tsc --noEmit
bun run build          # VERCEL=1 bun run build for the Vercel output
```

The same checks run in CI on every push and pull request (§2.2). The database tests apply
every migration to an in-process Postgres (PGlite) dressed up as a Supabase project
(`supabase/tests/pglite/harness.ts`); they never touch the real project.

The app talks to the real Supabase project; `localhost:8080` must be on the redirect list
(§3.1) for email links to come back to the local app.
