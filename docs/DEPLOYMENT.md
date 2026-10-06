# G&R Activate — Deployment

How G&R Activate is hosted and configured. This document grows per phase; sections
marked **TODO** are filled in by the phase that needs them (SPEC §35.15).

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
5. **Settings → Deployment Protection:** keep _Vercel Authentication_ on for preview
   deployments, so previews are not public.
6. **Settings → Domains:** add `<prod-domain>`.

A local check of the same build: `VERCEL=1 bun run build` must produce `.vercel/output`.

### 1.2 Environment variables

Settings → Environment Variables. Mark every **secret** as _Sensitive_. Names are also
listed in `.env.example`. The committed `.env` holds only public values; never put a
secret there, in code, or behind a `VITE_` prefix (those are bundled into the browser).

| Variable                        | Value                                                                | Secret? | Environments                                                      |
| ------------------------------- | -------------------------------------------------------------------- | ------- | ----------------------------------------------------------------- |
| `VITE_SUPABASE_URL`             | `https://blbazidqlesjokshfhiy.supabase.co`                           | no      | all                                                               |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Supabase → Project Settings → API Keys → publishable / `anon` key    | no      | all                                                               |
| `VITE_SUPABASE_PROJECT_ID`      | `blbazidqlesjokshfhiy`                                               | no      | all                                                               |
| `SUPABASE_URL`                  | same as `VITE_SUPABASE_URL`                                          | no      | all                                                               |
| `SUPABASE_PUBLISHABLE_KEY`      | same as `VITE_SUPABASE_PUBLISHABLE_KEY`                              | no      | all                                                               |
| `SUPABASE_SERVICE_ROLE_KEY`     | Supabase → Project Settings → API Keys → `service_role` / secret key | **yes** | Production (add Preview only when previews must test invitations) |
| `CRON_SECRET`                   | random, at least 32 characters: `openssl rand -hex 32`               | **yes** | Production                                                        |
| `APP_URL`                       | `https://<prod-domain>`                                              | no      | Production                                                        |
| `RESEND_API_KEY`                | Resend API key (optional, see §6)                                    | **yes** | Production                                                        |
| `EMAIL_FROM`                    | e.g. `G&R Solutions <noreply@<mail-domain>>` (optional)              | no      | Production                                                        |
| `EMAIL_REPLY_TO`                | e.g. `info@grsolutions.sr` (optional)                                | no      | Production                                                        |

Notes:

- `APP_URL` is the base of every link in emails and invitations. Without it the server
  falls back to `https://$VERCEL_PROJECT_PRODUCTION_URL` (set by Vercel), so preview
  deployments also send production links. Links are never built from the request's Host
  header (SPEC §35.2).
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

---

## 2. GitHub Actions (database migrations)

Already set up. On every push to `main` that touches `supabase/migrations/**`, the
workflow applies new migrations with `supabase db push` and commits regenerated types to
`src/integrations/supabase/types.ts`. Repository secrets (Settings → Secrets and
variables → Actions), both already set:

| Secret                  | Value                                                               |
| ----------------------- | ------------------------------------------------------------------- |
| `SUPABASE_ACCESS_TOKEN` | personal access token of the Supabase account that owns the project |
| `SUPABASE_DB_PASSWORD`  | database password of the project                                    |

Applied migrations are never edited; every change is a new file (SPEC §35.3).

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
and no invoices. It never deletes the record, so its GR number is never reused. It is safe
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

Further staff and admins are invited from `/admin/team` (P5), not with SQL.

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

**TODO (P8):** final check of the templates with Resend SMTP active (§6).

---

## 6. Email via Resend (custom SMTP) — TODO (P8)

To be written in P8: verify the sending domain in Resend, set `RESEND_API_KEY`,
`EMAIL_FROM`, `EMAIL_REPLY_TO` in Vercel, and configure Resend as custom SMTP in
Supabase (Authentication → Emails → SMTP Settings) so auth emails reach every customer.

## 7. Vault secrets for payment reminders — TODO (P8)

To be written in P8: the Supabase Vault secrets the scheduled reminder job uses to call
`/api/cron/*` with `CRON_SECRET`.

## 8. Pre-go-live reset — TODO (P10)

To be written in P10: SQL that removes test data before go-live while keeping
configuration (settings, statuses, rates, bank accounts) and the admin account.

## 9. Plans before go-live — TODO (P10)

Recommended before go-live: Supabase **Pro** (daily backups, no project pausing, leaked
password protection) and Vercel **Pro** (commercial use is not allowed on the Hobby
plan). Details and costs follow in P10.

---

## 10. Local development

```sh
bun install
bun run dev            # http://localhost:8080
bun run test           # unit tests + database tests (PGlite)
bunx tsc --noEmit
bun run build          # VERCEL=1 bun run build for the Vercel output
```

The app talks to the real Supabase project; `localhost:8080` must be on the redirect list
(§3.1) for email links to come back to the local app.
