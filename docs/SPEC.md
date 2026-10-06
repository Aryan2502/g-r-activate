We are building a complete production-ready web application called **G&R Activate** for **G&R Solutions**, a Surinamese customs brokerage & logistics company.

You already have access to the existing project context in Lovable. The Lovable project is called **G&R Activate**, and it is connected to the GitHub repository:

**g-r-activate**

You already have this project context available, so do NOT treat this as a completely new project.

## 1. FIRST: INSPECT THE EXISTING PROJECT

Before writing or changing code:

1. Inspect the existing G&R Activate project structure.
2. Inspect the existing GitHub repository and current implementation.
3. Inspect the existing Supabase setup/database if connected.
4. Identify what has already been built and preserve anything useful.
5. Do not unnecessarily rebuild existing functionality.
6. Check the existing authentication, database structure, components, routing, and styling.
7. Check for existing environment variables/configuration and use the existing architecture where appropriate.

The goal is to turn the existing project into a **fully functional end-to-end customer portal and admin system**, not merely create a visual mockup.

---

# 2. BRANDING & DESIGN

The application must use the existing **G&R Solutions branding**.

I will upload/provide:
- G&R Solutions logo
- G&R invoice template

Use these as the primary visual references.

The entire application should feel like one coherent G&R Solutions product.

Use:
- The logo
- Existing G&R colors
- Existing invoice visual identity
- Existing typography/style where appropriate
- Professional logistics/customs-business aesthetic
- Clean, modern SaaS/dashboard UX
- Responsive design
- Excellent desktop and mobile experience

Do NOT create generic "AI SaaS" styling.

The application should look like a serious logistics/customs brokerage platform used by real customers.

---

# 3. BUSINESS PURPOSE

G&R Solutions is a Surinamese customs brokerage & logistics company.

The portal is specifically intended for customers who:

1. Purchase products online, for example through:
   - Amazon
   - eBay
   - Other online stores

2. Use the **G&R Solutions US shipping address** as the shipping address for those purchases.

3. Register those shipments/orders inside G&R Activate.

The customer can then track their registered orders, shipment status, invoices, payments, and historical activity.

The system should support both:

### Personal Order
A customer registers their own online purchase.

### B2B Order
A business/customer has goods purchased or collected through G&R Solutions as part of a business arrangement.

The system should clearly distinguish these two order types.

---

# 4. CUSTOMER ACCOUNT & UNIQUE CUSTOMER ID

Every customer must have a unique G&R customer ID.

Format:

**GRXXXXX**

For example:

- GR00001
- GR00002
- GR00003

The ID must be unique and permanently associated with the customer.

## New customer registration

When a new customer registers:

1. Create the customer account.
2. Automatically generate a unique GRXXXXX customer ID.
3. Store it in Supabase.
4. Display it prominently in their profile/dashboard.
5. Prevent duplicate IDs.

The ID should preferably be generated server-side / atomically so concurrent registrations cannot create duplicate IDs.

Do NOT rely only on frontend JavaScript for uniqueness.

---

# 5. ADMIN INVITATIONS / EXISTING CUSTOMERS

Important:

G&R Solutions already has approximately **12 existing customers** who already have manually assigned customer IDs.

These customers are currently handled manually.

Therefore, the admin needs the ability to invite existing customers into the system.

## Admin invitation flow

Admin should be able to:

- Create/invite a customer.
- Enter their name.
- Enter email.
- Optionally enter their phone number.
- Optionally specify their existing G&R customer ID.
- Send an invitation email.
- Customer receives the invitation.
- Customer creates their account/password.
- Their existing GRXXXXX ID remains associated with their account.

Example:

Admin creates:

Name: John Doe  
Email: john@example.com  
Existing Customer ID: GR00017

The customer receives an invitation and after accepting it their account is associated with:

**GR00017**

If admin does NOT specify an existing ID, the system should generate a new ID automatically according to the GRXXXXX system.

The system must validate that manually entered customer IDs are unique.

---

# 6. AUTHENTICATION

Build a proper authentication system using Supabase Auth.

We need at minimum:

### Customer
- Login
- Logout
- Forgot password
- Password reset
- Account/profile
- Customer dashboard

### Admin
- Separate admin permissions/role
- Admin login
- Admin dashboard
- Customer management
- Order management
- Shipment management
- Invoice management

Use proper Supabase Row Level Security.

Customers must NEVER be able to access:
- Other customers' orders
- Other customers' invoices
- Other customers' shipments
- Admin functionality
- Internal admin data

Admin users should have the necessary elevated permissions.

Do not implement authorization only through frontend route hiding. Enforce permissions at the database/API level as well.

---

# 7. HOMEPAGE

Create a professional G&R Solutions homepage.

It should explain:

- What G&R Solutions does
- How the customer shipping process works
- That customers can use the G&R US address for online purchases
- Registering shipments/orders
- Shipment tracking/status
- Customs/logistics handling
- Invoice/payment management

Include a clear CTA:

**Login / Customer Portal**

And, if appropriate:

**Create Account**

The homepage should visually match the G&R Solutions brand.

---

# 8. CUSTOMER DASHBOARD

After logging in, customers should immediately see a useful overview.

Dashboard cards should include at minimum:

### Orders
Number of registered orders.

### Open Invoices
Number of invoices that are not yet fully paid.

### Shipments
Number of shipments currently pending/in transit/awaiting processing.

### Ready for Pickup
Number of shipments ready for pickup.

Potential additional useful information:

- Total outstanding balance
- Latest order
- Latest shipment status
- Recent invoices
- Recent activity

Make the dashboard visually clear and easy to understand.

---

# 9. CUSTOMER ORDER REGISTRATION

Customers need a clear **"Order aanmelden" / "Register Order"** flow.

They should be able to choose:

### Personal Order
Their own online purchase.

### B2B Order
A business-related shipment/order.

The registration form should capture relevant information.

At minimum consider:

- Order type
- Store/vendor
- Order number
- Tracking number
- Tracking carrier
- Description of goods
- Quantity
- Estimated value
- Currency
- Weight if known
- Notes
- Optional upload of supporting document/invoice
- Date of purchase
- Expected delivery date if known

Tracking number should be explicitly marked as:

**Optional / indien bekend**

Do not require tracking information if the customer does not have it yet.

The system should generate an internal unique order/shipment reference as well.

---

# 10. ORDER DETAIL

Customers should be able to open an order and see:

- Order reference
- Customer ID
- Order type
- Store/vendor
- Order number
- Tracking number
- Carrier
- Description
- Weight
- Value
- Current status
- Shipment history
- Invoice(s)
- Payment status
- Important dates
- Notes/messages where appropriate

Use a clear timeline for shipment progress.

Example:

Order registered  
↓  
Arrived at US warehouse  
↓  
In transit  
↓  
Arrived in Suriname  
↓  
At customs  
↓  
Cleared  
↓  
Ready for pickup

The actual statuses must be configurable by admin.

---

# 11. SHIPMENT STATUS MANAGEMENT

Admin must be able to change shipment status.

Initial status possibilities can include:

- Pending
- Order Registered
- Awaiting Shipment
- Arrived at US Warehouse
- In Transit
- Arrived in Suriname
- At Customs
- Customs Cleared
- Ready for Pickup
- Picked Up
- Delivered
- Cancelled

Use a flexible status system so G&R can add/change statuses later without redesigning the entire application.

When admin changes the status:

- Store the change in the database.
- Record timestamp.
- Record which admin made the change.
- Add it to the shipment/order timeline.
- Show the new status to the customer.

If appropriate, trigger an email notification to the customer through Supabase/email infrastructure.

---

# 12. ADMIN DASHBOARD

Create a proper admin dashboard.

Admin should immediately see:

- Total customers
- New customers
- Orders registered
- Orders pending
- Shipments in transit
- Shipments at customs
- Ready for pickup
- Open invoices
- Overdue invoices
- Paid invoices
- Outstanding amount

Include recent activity.

The admin dashboard should be useful operationally, not just decorative.

---

# 13. CUSTOMER MANAGEMENT

Admin needs a customer management section.

Admin should be able to:

- View all customers
- Search customers
- Filter customers
- Open customer profile
- View customer ID
- View contact information
- View orders
- View shipments
- View invoices
- Invite customer
- Edit customer information
- Disable/deactivate account where appropriate

Customer profile should show a complete history.

---

# 14. INVOICE GENERATION

This is an important part of the application.

Admin must have a button:

**"Genereer factuur"**

When clicking it, open a professional invoice-generation modal/page.

The invoice generation UI should contain the necessary billing/logistics fields.

At minimum, support fields such as:

- Customer
- Customer ID
- Invoice date
- Due date
- Shipment/order reference
- Weight in lbs
- Shipping/logistics charges
- Customs-related charges if applicable
- Handling fees
- Other charges
- Discounts if applicable
- Tax/VAT if applicable
- Total
- Notes

The exact fields should be designed so G&R can expand them later.

---

# 15. LIVE INVOICE PREVIEW

I will provide the existing G&R Solutions invoice template.

Use this invoice template as the visual source of truth.

When admin generates an invoice, the interface should show:

### Left side:
Invoice form / editable fields

### Right side:
Live invoice preview

Changes to fields should update the invoice preview in real time.

The preview should look as close as reasonably possible to the provided G&R invoice template.

Do not create a generic invoice.

Use:
- G&R logo
- G&R colors
- Correct spacing
- Invoice structure
- Customer information
- Billing information
- Line items
- Totals
- Relevant G&R details

---

# 16. INVOICE GENERATION & STORAGE

Once admin clicks:

**Generate Invoice**

the system should:

1. Validate required fields.
2. Create a unique invoice number.
3. Save the invoice in Supabase.
4. Associate it with the customer.
5. Associate it with the relevant order/shipment.
6. Store all invoice line items.
7. Store the total.
8. Store invoice status.
9. Make the invoice visible in the customer's portal.

The invoice should NOT disappear after page refresh.

It must be persisted in the database.

---

# 17. INVOICE STATUS

Invoices should support statuses such as:

- Draft
- Open / Unpaid
- Paid
- Overdue
- Cancelled

Admin must be able to update invoice status.

Customers should clearly see their invoice status.

For example:

**PAID**

**OPEN**

**OVERDUE**

Use clear visual indicators.

---

# 18. CUSTOMER INVOICE PAGE

Customers should have an invoice section where they can see:

- Invoice number
- Date
- Due date
- Related shipment/order
- Amount
- Status

They should be able to open an invoice and view the invoice in the G&R template.

If appropriate, allow them to download/print the invoice as PDF.

---

# 19. PAYMENT REMINDERS

The system should support email reminders for unpaid/overdue invoices.

Use Supabase/email infrastructure where appropriate.

Potential reminders:

- Invoice generated
- Invoice due soon
- Invoice overdue
- Payment confirmation

Do NOT hardcode email credentials.

Use environment variables / Supabase infrastructure securely.

Admin should be able to see whether an invoice reminder was sent.

Store relevant timestamps such as:

- First reminder sent
- Last reminder sent
- Number of reminders

Avoid sending duplicate reminders accidentally.

---

# 20. CUSTOMER HISTORY

Customers need a complete history section.

They should be able to see historical:

- Orders
- Shipments
- Invoices
- Payments
- Status changes

Provide filters/search where useful.

For example:

**2026**
- 12 orders
- 8 shipments
- 7 invoices

Allow the customer to open historical records.

---

# 21. ADMIN ORDER/SHIPMENT MANAGEMENT

Admin should have a centralized operational view.

Something similar to:

| Order | Customer | Type | Tracking | Status | Invoice | Payment |
|---|---|---|---|---|---|---|

Admin should be able to:

- Search
- Filter
- Sort
- Open details
- Change shipment status
- Generate invoice
- View invoice
- Update invoice status
- View customer

Make this genuinely usable for daily operations.

---

# 22. DATABASE DESIGN

Use Supabase/PostgreSQL properly.

Design a clean relational schema.

Likely entities include:

- users/profiles
- customers
- admin users/roles
- orders
- shipments
- shipment_status_history
- invoices
- invoice_items
- payments
- invitations
- notifications/email logs

Do not unnecessarily duplicate data.

Use foreign keys and proper indexes.

Customer IDs and invoice numbers must have database-level uniqueness constraints.

---

# 23. ROW LEVEL SECURITY

Implement proper Supabase RLS.

Customer:

Can only access their own:
- Profile
- Orders
- Shipments
- Invoices
- Payments
- Notifications/history

Admin:

Can access operational data according to their role.

Do NOT rely solely on frontend filtering.

Test RLS carefully.

---

# 24. EMAIL SYSTEM

Set up the application so transactional emails can be sent through Supabase-compatible infrastructure.

Emails may include:

- Customer invitation
- Welcome/account setup
- Order confirmation
- Shipment status update
- Invoice generated
- Payment reminder
- Overdue invoice reminder
- Payment confirmation

Create professional branded email templates using G&R branding.

---

# 25. RESPONSIVE DESIGN

The application must work properly on:

- Desktop
- Laptop
- Tablet
- Mobile

Do not simply shrink the desktop UI.

On mobile:

- Navigation should become mobile-friendly.
- Tables should become cards or horizontally scrollable where appropriate.
- Forms should remain easy to use.
- Invoice preview should remain usable.

---

# 26. UX REQUIREMENTS

Prioritize usability.

A customer who is not technically skilled should be able to:

1. Login
2. Register an order
3. Enter tracking information
4. View shipment status
5. View invoice
6. Understand whether payment is required
7. View history

with minimal friction.

Admin should be able to:

1. Find customer
2. Find order
3. Update shipment status
4. Generate invoice
5. Update invoice status
6. Send/manage reminders

quickly.

---

# 27. SECURITY

Treat this as a real application containing customer and financial information.

Implement:

- Supabase RLS
- Secure authentication
- Role-based access
- Server-side validation where necessary
- Database constraints
- Secure file uploads
- Protected admin routes
- No exposed secrets
- Environment variables
- Proper error handling
- Audit-friendly timestamps
- Avoid exposing sensitive database information to the client

Never put service-role keys in frontend code.

---

# 28. AUDIT TRAIL

For important administrative actions, record:

- Who performed the action
- What changed
- When it changed

Especially for:

- Shipment status changes
- Invoice creation
- Invoice status changes
- Customer changes
- Customer ID assignment

This will make the application much easier to operate professionally.

---

# 29. ERROR HANDLING

Do not allow silent failures.

Every important action should provide clear feedback.

Examples:

Success:
"Invoice successfully generated."

Error:
"We couldn't generate this invoice. Please check the required fields."

Order registration:
"Order successfully registered."

Use proper loading states, empty states, confirmation dialogs, and error states.

---

# 30. DO NOT BUILD A STATIC DEMO

This is extremely important.

Do NOT:

- Use fake customer data as the primary system.
- Hardcode dashboard numbers.
- Hardcode invoices.
- Fake shipment statuses.
- Build buttons that don't actually work.
- Use frontend-only authentication.
- Store important data only in localStorage.
- Create fake invoice previews that are not connected to the database.

Everything important must be connected to Supabase and persist after refresh/logout/login.

---

# 31. END-TO-END ACCEPTANCE TEST

Before considering the application finished, test the complete flow.

### Customer flow

1. Customer creates account.
2. System generates GRXXXXX ID.
3. Customer logs in.
4. Customer sees dashboard.
5. Customer registers personal order.
6. Order is saved.
7. Admin sees the order.
8. Admin changes shipment status.
9. Customer sees updated status.
10. Admin generates invoice.
11. Invoice is saved.
12. Customer sees invoice.
13. Admin marks invoice paid.
14. Customer sees PAID.
15. Customer can view the order/invoice in history.

### Existing customer flow

1. Admin invites existing customer.
2. Admin enters existing GRXXXXX ID.
3. Customer receives invitation.
4. Customer completes account setup.
5. Existing GRXXXXX ID remains intact.
6. Customer can use the portal normally.

### B2B flow

1. Customer registers B2B order.
2. Order is clearly marked B2B.
3. Admin sees B2B order.
4. Admin can process shipment and invoice normally.

### Invoice flow

1. Admin opens Generate Invoice.
2. Admin selects customer/order.
3. Admin enters lbs and other charges.
4. Live preview updates.
5. Admin generates invoice.
6. Invoice is persisted.
7. Customer can view it.
8. Admin changes status.
9. Customer sees updated status.

---

# 32. DEVELOPMENT APPROACH

Work in phases, but actually implement each phase.

### Phase 1
Inspect existing project + architecture + database.

### Phase 2
Authentication + customer/admin roles + customer IDs.

### Phase 3
Customer dashboard + order registration.

### Phase 4
Shipment management + status history.

### Phase 5
Admin dashboard + customer/order management.

### Phase 6
Invoice generation + live preview using G&R template.

### Phase 7
Invoice storage + customer invoice portal.

### Phase 8
Email notifications/reminders.

### Phase 9
History + audit trail.

### Phase 10
Security/RLS testing + responsive UX + end-to-end testing.

Do not stop after creating the UI.

---

# 33. IMPORTANT DESIGN PRINCIPLE

The application should feel like a **real G&R Solutions customer portal**, not a generic logistics dashboard.

Use the provided logo and invoice template as the main design reference.

Keep the UI:
- Professional
- Trustworthy
- Clean
- Modern
- Easy to understand
- Operationally efficient

Avoid unnecessary animations, excessive gradients, generic AI-generated dashboard patterns, or overly complicated navigation.

---

# 34. IMPORTANT: ASK ONLY WHEN NECESSARY

You have enough information to begin implementation.

Do NOT stop and ask me for clarification about every small design or implementation decision.

Use sensible professional defaults.

Only ask me when a decision genuinely requires business-specific information that cannot reasonably be inferred.

If something is not yet provided, build the architecture so it can easily be configured later.

---

# FINAL OBJECTIVE

Build **G&R Activate** as a complete, production-ready web application connected to the existing GitHub repository and Supabase backend.

It needs:

**Public Homepage → Authentication → Customer Portal → Order Registration → Shipment Tracking → Invoice Generation → Invoice Management → Payment Status → Email Notifications → Customer History → Admin Dashboard → Customer Management → Order/Shipment Management**

Everything should work end-to-end and persist in the database.

Start by inspecting the existing G&R Activate Lovable/GitHub project and then continue implementation from the existing codebase rather than starting over.

---

# 35. ADDITIONAL SPECIFICATIONS (review of §1–§34 + owner decisions)

This section refines §1–§34. Where it differs, this section wins.
- **[configurable]** means: a default stored in an admin-editable setting.
- **[owner to confirm]** means: use the default given here until G&R provides the real value.

## 35.0 Owner decisions (final)
- **UI language: Dutch only.** All UI strings, toasts and validation messages live in `src/lib/i18n/nl.ts` (keyed), so English can be added later without touching components. `<html lang="nl">`. The §29 toasts become: "Factuur succesvol aangemaakt.", "We konden deze factuur niet aanmaken. Controleer de verplichte velden.", "Order succesvol aangemeld." Invoices and emails always use the template's Dutch wording.
- **Customer codes.** The ~12 existing customers already have 5-digit codes (GR000xx). Format: `GR` + 5 digits, always.
- **Order model.** 1 order = 1 inbound package (one tracking number, which may be added later). If a purchase arrives in several boxes, "Extra pakket toevoegen" creates a linked sibling order (`parent_order_id`). One invoice can bill several orders of the same customer.
- **Registration.** Public self-registration AND admin invitations are both enabled from the start (`public_signup_enabled` [configurable, default true]).

## 35.1 How this spec is executed (refines §1, §32)
- **Known facts (replaces the §1 inspection).**
  - The repo is the unmodified TanStack Start template plus Lovable's generated Supabase integration (`src/integrations/supabase/*`).
  - The homepage is a placeholder. There are no app routes and no `supabase/migrations`.
  - The connected Supabase project (ref `blbazidqlesjokshfhiy`, us-east-1, Free plan) has no tables.
  - `drizzle/schema.ts` is blank on purpose.
- **One phase per message.** I will send one message per phase. Build ONLY that phase, completely, then stop and end with the Phase Report. Never scaffold routes or pages for later phases. If a message starts with CARRY-OVER FIXES, do those first.
- **Phases.**
  - P1: plan only.
  - P2a: database foundation, as 3 separately applied migrations (see §35.3).
  - P2b: auth, role routing, design tokens, brand assets, layouts, basic homepage, i18n, first `docs/DEPLOYMENT.md`.
  - P3: customer dashboard and order registration/detail.
  - P4: status management, timeline, shipments (batches), receiving and pickup.
  - P5: admin dashboard, customer management, invitations, team, settings.
  - P6: invoice builder with live preview.
  - P7: issuing, numbering, payments, customer invoice pages, print/PDF.
  - P8: email and reminders.
  - P9: history, audit views, CSV export.
  - P10: final homepage, responsive pass, RLS tests, acceptance and deployment docs.
- **Definition of Done (every phase).** A phase is NOT done if any of these is true:
  - a visible control has no working handler, or says "binnenkort";
  - a number, list or badge on screen is not read from Supabase;
  - business data lives only in React state or localStorage;
  - UI was written against a table or column whose migration has not been applied (STOP and say so instead);
  - a table has no RLS or explicit grants;
  - a server function trusts a role or customer_id sent by the client;
  - loading, empty or error states are missing, or success/error toasts are missing.
- **If you run out of room**, stop at a coherent point and list what remains. Never fill gaps with placeholder UI.
- **Phase Report.** End every phase with these headings:
  1. Files changed
  2. Migrations (file → purpose → applied yes/no)
  3. RLS/grants (table | role | operation | condition)
  4. Server functions/routes (name | caller | service role? why)
  5. Wiring: each new control → the function or table it writes; each displayed number → the query behind it
  6. Verified by me (what I ran and what I saw) / Not verified (why)
  7. Stubs and gaps
  8. Open business inputs + the default in use
- **Verification for DB phases.** Also include the output of these read-only queries (if you cannot run SQL, say so and I will have the owner run them):
  - `select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' order by 1;`
  - `select schemaname, tablename, policyname, cmd, roles from pg_policies where schemaname in ('public','storage') order by 1,2,3;`
  - `select p.proname, p.prosecdef, p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') order by 1;`
  - `select id, public, file_size_limit from storage.buckets;`

  Never mark something as verified that you did not actually run.
- **Docs.**
  - `docs/SPEC.md` holds this full spec (§1–§35) verbatim.
  - `docs/PROGRESS.md` holds a status table per section with evidence, open business inputs with the defaults in use, and carry-over fixes.
  - Read both at the start of every phase; update PROGRESS.md at the end.

## 35.2 Platform: Vercel hosting + the owner's own Supabase (critical)
- **Hosting.** Production runs on **Vercel**, auto-deployed from the GitHub repo. Lovable is only the editor and preview.
- **Backend.** Database, Auth and Storage are the owner's own Supabase project `blbazidqlesjokshfhiy`.
- **Do NOT use any of these:**
  - Lovable Cloud, or enabling a Lovable database
  - Lovable Emails (`@lovable.dev/email-js`) or `@lovable.dev/webhooks-js`
  - the Lovable AI gateway
  - Lovable scheduled jobs, `LOVABLE_CRON_SECRET`, or the generated `cron-auth.ts`
  - Supabase Edge Functions (no `supabase/functions/*`)
  - publishing to Lovable hosting

  If something seems to need one of these, say so in the Phase Report instead.
- **Generated files.** Never edit `src/integrations/supabase/*`, `src/routeTree.gen.ts` or `drizzle/*`. Keep `src/start.ts` (CSRF + attachSupabaseAuth) and `src/server.ts` as they are.
- **No Drizzle, no direct Postgres.** All data access goes through `@supabase/supabase-js`, and all schema changes are SQL files in `supabase/migrations`. Never introduce `DATABASE_URL` (it would bypass RLS).
- **Server code.**
  - Privileged logic goes in TanStack `createServerFn` functions in `src/lib/server-fns/<area>.functions.ts`, plus server routes under `src/routes/api/…`.
  - Server-only helpers live in `src/server/*.ts` and are loaded with `await import()` inside handlers, like `client.server.ts`. Client code never imports `**/server/**`.
  - Every privileged function chains `.middleware([requireSupabaseAuth])`, then a `requireStaff`/`requireAdmin` check (which calls `public.is_staff()`/`public.is_admin()` with the user's client and throws 403), then a zod validator.
  - Default to the user-scoped `context.supabase`, so RLS applies and triggers see `auth.uid()`.
  - `supabaseAdmin` (service role) is allowed only for:
    - `auth.admin.*` (createUser, updateUserById, ban/unban, generateLink);
    - invitation lookup and redemption, after validating the invitation token hash;
    - email-log bookkeeping;
    - the reminder job, after the CRON_SECRET check.
- **Runtime and build.**
  - Do not change the nitro/preset settings in `vite.config.ts`. Add no `wrangler.*`, `nitro.config.ts` or `vercel.json`.
  - A local `VERCEL=1 bun run build` already produces a valid `.vercel/output` with the vercel preset. Add `.vercel` to `.gitignore`.
  - Use only pure-JS npm packages. `node:crypto` is allowed only via `await import()` inside server handlers. No native addons, no Puppeteer or headless Chrome, no filesystem writes, no in-memory state between requests.
  - Files never pass through server functions (Vercel's body limit is 4.5 MB); the browser uploads directly to Storage.
- **Auth and SSR.**
  - Keep the generated localStorage session.
  - `src/routes/portal/route.tsx` and `src/routes/admin/route.tsx` are `ssr: false`. Their `beforeLoad` awaits `supabase.auth.getSession()` and redirects to `/login?redirect=…`.
  - `/admin` also checks `is_staff()`; customers are sent to `/portal`.
  - `redirect` is accepted only if it starts with `/` and not `//`.
  - Load protected data with TanStack Query (user id in the query keys) and call `queryClient.clear()` on sign-out.
  - After login, staff land on `/admin` and customers on `/portal`.
  - `public/robots.txt` disallows `/portal`, `/admin`, `/invite` and `/auth`, and those layouts set `noindex`.
- **Env and secrets.**
  - Treat the committed `.env` and the repo as PUBLIC. No secret goes there, in code, or behind a `VITE_` prefix.
  - `src/server/env.ts` exports one lazy getter per variable, each validating only its own variable on first use and throwing a named error: `getServiceRoleKey()`, `getCronSecret()`, `getAppUrl()`, `getResendConfig()`. A missing CRON_SECRET only breaks `/api/cron/*`.
  - `getAppUrl()` returns `APP_URL`, else `https://${VERCEL_PROJECT_PRODUCTION_URL}`. Links in emails are never built from the Host header or `window.location`.
  - Client auth calls use `window.location.origin` for their redirect URLs.
  - `RESEND_API_KEY` and `EMAIL_FROM` are optional: without them, email becomes a `skipped_no_provider` log row, never an exception.
  - Deliver `.env.example` with names only.
- **Admin "Systeemstatus" panel.** Shows booleans only, never values: service role configured, email provider configured, APP_URL set, and the last reminder job run with its status.

## 35.3 Database conventions (refines §22, §23, §27)
- **Migrations.**
  - Every change is `supabase/migrations/<YYYYMMDDHHMMSS>_<name>.sql`. Applied migrations are never edited.
  - Use idempotent forms: `if not exists`, `create or replace function`, `drop policy if exists` before `create policy`, `on conflict do nothing` for seeds.
  - No secrets, environment URLs or real customer data in migrations.
  - Regenerate `types.ts` after each migration; never use `as any`.
- **P2a order: 3 migrations, each applied and reported separately.**
  1. Identity & settings: enums, schema `private`, profiles, user_roles, role helpers, customers + number generator, invitations, company_settings, company_bank_accounts, warehouse_addresses, service_rates, audit_log + trigger, `handle_new_user`.
  2. Operations: shipment_statuses + seed, orders, shipments, shipment_status_history, order_documents + storage bucket and policies, internal_notes.
  3. Billing & messaging: invoices, invoice_items, invoice_number_counters, payments, the invoice_overview view, email_logs, job_runs.
- **Grants (independent of project defaults).** For every table and view:
  - `revoke all … from anon, authenticated;`
  - grant back only the verbs actually used, to `authenticated`;
  - grant to `service_role` what server code needs.

  For every function in `public`: `revoke execute … from public, anon`, and from `authenticated` too unless the client or a policy calls it. Every table: `enable row level security`, with one policy per command `to authenticated`. `anon` gets nothing except SELECT on `company_settings` (public contact and terms text only).
- **Security-definer rules.**
  - Every trigger function, and every function that writes to another table, uses a sequence or reads `private.*`, is SECURITY DEFINER. It lives in schema `private`, has `set search_path = ''` and fully qualified names, and has execute revoked from public, anon and authenticated.
  - Never add client write policies to `shipment_status_history`, `audit_log`, `email_logs`, `job_runs` or `invoice_number_counters` to make a trigger work. `authenticated` gets no USAGE on any sequence.
  - **Every SECURITY DEFINER RPC callable by `authenticated` starts with an explicit guard**, e.g. `if not (select public.is_admin()) then raise exception 'Geen toegang' using errcode = '42501'; end if;` (`is_staff()` for staff RPCs, `current_customer_id()` ownership checks for customer RPCs). It then validates that the target rows exist and are in the expected state.
- **Policy helpers.** Customer conditions use `(select public.current_customer_id())`; staff conditions `(select public.is_staff())`; admin conditions `(select public.is_admin())`. `using (true)` is allowed only for read-only lookups.
- **Views.** All views use `with (security_invoker = true)`, plus explicit grants.
- **Indexes.** Every FK and every policy column is indexed.
- **RLS filters rows, not columns.** Customer-readable tables never hold staff-only text. Staff-only remarks go in `internal_notes(id, customer_id, order_id null, invoice_id null, payment_id null, body, created_by default auth.uid(), created_at)`, which has staff-only policies. Free-text columns that customers can read are named `customer_note` and labelled "Zichtbaar voor klant" in the UI.
- **Types.**
  - Money `numeric(12,2)`; weights `numeric(10,2)` lbs; never float.
  - Instants are `timestamptz`; invoice_date, due_date, paid_on, purchase_date and expected_delivery_date are `date`.
- **Time zone.** The business time zone is America/Paramaribo (UTC−3, no DST).
  - In SQL, "today" is `(now() at time zone 'America/Paramaribo')::date`.
  - In TS, use one helper, `todayInSuriname()`.
- **Seeds.** Reference and config rows only: statuses, the company_settings singleton, three empty bank-account rows, service_rates. Never seed demo customers, orders or invoices.

## 35.4 Roles, first admin, team (refines §6, §23)
- **Schema.** `app_role` enum ('admin','staff') and `user_roles(id, user_id → auth.users on delete cascade, role, created_at, created_by, unique(user_id, role))`.
- **Never:**
  - put a role column on profiles or customers;
  - read roles from user_metadata or JWT claims;
  - derive admin from an email address or "first user".

  Admins are normal Supabase Auth users who use the same `/login`.
- **Helpers** (stable, SECURITY DEFINER, executable by authenticated): `has_role(_user_id, _role)`, `is_admin()`, `is_staff()` (admin or staff).
- **user_roles RLS.** Users read their own rows; admins read all. No write policies: changes go through the guarded RPC `set_user_role(_user_id, _role, _grant)`, which refuses to remove the last admin.
- **Permissions (v1).**
  - Staff do all daily work: customers, orders, statuses, draft and issue invoices, record payments, invite and edit customers.
  - Admin-only: team & roles, settings & counters, changing a customer code, cancelling issued invoices, voiding payments, disabling customers, applying the late fee.
- **First admin.** There is no in-app path. `docs/DEPLOYMENT.md` gives one-time SQL for the owner to run in the Supabase SQL editor after signing up normally. It grants the admin role and then unlinks the auto-created customer row (`user_id = null, status = 'disabled', disabled_reason = 'bootstrap admin'`) if it has no orders or invoices. It never deletes the row.
- **Profiles.** Staff may SELECT all profiles, so audit timelines can show "door Maria". Customers see the status history without staff names (shown as "G&R Solutions").
- **Team page `/admin/team`.** Invite staff, change roles, deactivate.

## 35.5 Customers and GR codes (refines §4, §5, §13)
- **profiles.** `profiles(id → auth.users, display_name, created_at, updated_at)`, holding no privileged fields.
- **customers.** All contact data lives here.
  - Columns: `customers(id, user_id unique null → auth.users on delete set null, customer_number int unique not null check 1–99999, customer_code text unique not null, account_type ('personal','business'), full_name not null, company_name, kkf_number, contact_person, email null, phone, address, district, status ('invited','active','disabled'), terms_version, terms_accepted_at, disabled_at, disabled_by, disabled_reason, created_*, updated_*)`.
  - Unique index on `lower(email)` where email is not null. A business account requires company_name.
- **References.** Every business table references `customers.id`, never `auth.users`. Staff can create customers and orders for customers who have no login yet.
- **customer_code.**
  - Always `'GR' || lpad(customer_number::text, 5, '0')`, set ONLY by a DB trigger.
  - Admin input such as "gr00017" or "GR 17" is normalised (trim, upper-case, strip spaces and "GR"; 1–5 digits) and stored as the number.
  - A duplicate is rejected with "GR00017 is al toegewezen aan <naam>".
- **New numbers.**
  - Generated by `private.next_customer_number()` from a sequence (start [configurable]; default = one above the highest imported number, minimum 100). It skips numbers already used, and on unique_violation retries up to 5 times. Never `max()+1` in JS.
  - The admin RPC `set_next_customer_number(n)` accepts only n > max(customer_number).
  - Numbers are never reused.
- **Customer self-service.** Customers SELECT only their own row and edit contact details only via the RPC `update_my_contact(...)`. A BEFORE UPDATE trigger rejects non-admin changes to customer_number, customer_code, user_id, status, email and created_by.
- **`current_customer_id()`** returns the customer where `user_id = auth.uid() and status = 'active'`. A disabled customer therefore sees nothing.
- **Changing a code.** Admin only, with a required reason, only while the customer has no orders or issued invoices. Audited.
- **Disable/enable.** An admin server function sets the status and calls `auth.admin.updateUserById(user_id, { ban_duration: '876000h' | 'none' })`. The login page maps the banned error to "Uw account is gedeactiveerd. Neem contact op met G&R Solutions."
- **"Klant toevoegen" (staff).** Creates a customer WITHOUT an invitation. Name and phone are required; email and an existing GR number are optional. "Uitnodigen" is a separate action, available once an email exists.

## 35.6 Sign-up, invitations, auth emails (refines §4, §5, §6; security-critical)
- **Why custom tokens.** Until Resend SMTP is configured in Supabase, Supabase's built-in mailer only delivers to members of the owner's Supabase organisation, so nothing customer-critical may depend on it. Do NOT use `auth.admin.inviteUserByEmail`. Invitations use their own token, and the link can always be copied.
- **`invitations` table.**
  - Columns: `invitations(id, kind ('customer','staff'), customer_id null, staff_role null, email not null, token_hash unique not null, expires_at default now()+7 days, created_by, created_at, last_sent_at, send_count, accepted_at, accepted_by, revoked_at)`.
  - A check ties kind to customer_id or staff_role. A partial unique index allows one open invitation per customer.
  - Staff-only RLS; no anon access.
- **Admin/staff invites a customer** (server function).
  1. Look up customers by `lower(email)`.
     - If a LINKED customer exists with no orders and no issued invoices, offer "Code wijzigen naar GRxxxxx" (the audited code-change path) instead of inviting.
     - If it has orders or invoices, show the conflict with a link to that customer.
     - Never create a second row for the same email.
  2. Otherwise create or reuse the customer row (status 'invited', user_id null, with the given or a generated number), so the GR code is reserved.
  3. Create a token: 32 random bytes, base64url. Store only its SHA-256 hash.
  4. The link is `${APP_URL}/invite/<token>`. ALWAYS show "Kopieer uitnodigingslink" and "Deel via WhatsApp". Also email it when Resend is configured.
  5. "Opnieuw versturen" rotates the token, so old links stop working. Limit it to 1 per minute and 5 per day, using last_sent_at and send_count.
- **`/invite/$token`.**
  - A server function (service role, after hashing and validating the token) returns only the first name, a masked email, the GR code, and expired/accepted flags.
  - The person chooses a password (minimum 8 characters); the email is read-only.
  - Redemption (service role) looks up the auth user via a service-role-only SQL function `public.admin_auth_user_by_email(_email)` (execute revoked from public, anon and authenticated):
    - (a) no user → `auth.admin.createUser({ email, password, email_confirm: true, app_metadata: { invitation_id } })`;
    - (b) user exists but is unconfirmed → `auth.admin.updateUserById(id, { password, email_confirm: true, app_metadata: { invitation_id } })`, because holding the token proves control of the email;
    - (c) user exists and is confirmed → ask them to log in with their existing password, then redeem for that logged-in user, only if their email matches the invitation.
  - In every case the server function then links the invitation itself, idempotently: customers.user_id plus status 'active' (or user_roles for staff), and marks the invitation accepted. It must not rely on a trigger having done this.
  - The client then signs in. Customers go to `/portal`, staff to `/admin`.
- **Trigger `private.handle_new_user()` on auth.users.**
  - Fires `AFTER INSERT OR UPDATE OF email_confirmed_at`.
  - Always ensures a profiles row. Creates a customer only once `email_confirmed_at` is not null, so unconfirmed or bot sign-ups do not use up GR codes. This works whether "Confirm email" is on or off.
  - Idempotent: it skips if a customer with this user_id exists, if the user has a staff role, or if `raw_app_meta_data->>'invitation_id'` is set.
  - It NEVER reads customer_code, number, role, status or ids from `raw_user_meta_data` (users control that). Only display fields (full_name, phone, account_type, company_name, terms_version) may be copied from there.
  - If an unlinked customer row or an open invitation has the same email, it creates NOTHING. The portal then shows "G&R heeft al een klantdossier voor dit e-mailadres – gebruik uw uitnodigingslink of vraag een nieuwe aan", and staff get a task. An existing GR code is linked ONLY by redeeming a token, never by matching email.
- **Self-registration** (when `public_signup_enabled`).
  - `signUp` with `emailRedirectTo: origin + '/auth/confirm'`.
  - Fields: full name as on the ID document, phone/WhatsApp (required, +597 prefilled), email, password, account type (company name if business), and a terms checkbox.
  - Handle both outcomes: a session is returned → `/portal`; otherwise show "Controleer uw inbox".
  - The page also says: "Al klant van G&R? Vraag ons om uw uitnodigingslink."
- **Password reset.** `resetPasswordForEmail(email, { redirectTo: origin + '/auth/confirm' })`. The response never reveals whether the email exists. Staff also get "Wachtwoord-resetlink maken" (`auth.admin.generateLink({ type: 'recovery' })`, shown as a copyable link built from `hashed_token`).
- **`/auth/confirm`.**
  - Handles `?token_hash&type` with a "Doorgaan" button, calling `verifyOtp` only on click so mail scanners cannot use up the token. Also handles Supabase's default link.
  - Recovery goes to `/auth/set-password`.
  - Expired or used links get a clear message plus "Nieuwe link aanvragen".
- **Branded auth templates.** Write `supabase/templates/{confirm_signup,recovery,magic_link}.html` with links of the form `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=…`. The owner pastes them into Supabase later.

## 35.7 Orders, statuses, shipments, receiving, pickup (refines §9, §10, §11, §21)
- **`orders` columns.**
  - Identity and ownership: id; `reference` unique 'ORD-YYYY-NNNNN' (set by a DB trigger); customer_id; created_by; created_by_role ('customer','staff'); timestamps; updated_by.
  - Type: `order_type` ('personal','b2b'); `service_type` ('air','sea', default 'air').
  - Purchase: store_vendor; vendor_order_number; description; quantity; estimated_value; estimated_value_currency (default 'USD'); purchase_date; expected_delivery_date; customer_note.
  - Tracking: tracking_number (optional, "Optioneel / indien bekend"); `tracking_number_normalized` (upper-case, no spaces or dashes, indexed); carrier.
  - Weight: `declared_weight_lbs` (entered by the customer); `measured_weight_lbs` (entered by staff; used for invoicing).
  - Status and links: `status` → shipment_statuses.code; shipment_id null; parent_order_id null.
  - Receiving and pickup: received_at, received_by, picked_up_at, picked_up_by_name, handed_over_by, cancellation_requested_at.
- **B2B fields** (b2b orders only): company context comes from the customer; plus supplier_name, client_po_number, purchase_mode ('customer_purchased','gr_purchases') [owner to confirm meaning].
  - B2B orders get a "Zakelijk" badge and their own filter.
  - Before a B2B order reaches the at_customs stage, warn (do not block) if no commercial invoice or packing list is uploaded.
- **Customer writes.**
  - INSERT only for `current_customer_id()`. A BEFORE INSERT trigger resets every column NOT on the customer-editable list to its default or NULL for non-staff, so status, reference, received/picked-up fields, measured weight, shipment_id, etc. cannot be set.
  - UPDATE only on the customer-editable fields, and only while the status stage is 'registered' (enforced by a trigger).
  - No delete. "Annulering aanvragen" goes through the RPC `request_order_cancellation(_order_id)`, which checks ownership, sets the timestamp once and gives staff a task.
- **Statuses.**
  - Table: `shipment_statuses(code pk, label_nl, customer_description_nl, stage, sort_order, is_terminal, customer_visible, notify_customer, active)`.
  - `stage` enum: registered, us_warehouse, in_transit, arrived_sr, at_customs, cleared, ready_for_pickup, completed, cancelled, action_required. Dashboard cards, the timeline and email triggers use `stage`, never labels.
  - Seed the §11 list, mapped to stages, with Dutch labels. Add "Actie vereist – documenten nodig" (action_required): the customer sees a banner with staff's message and an upload button.
  - Statuses that are in use can be deactivated, not deleted. "Delivered" is offered only if `delivery_available` is true [configurable, default false].
- **Status changes go through ONE guarded RPC:** `public.change_order_status(_order_ids uuid[], _to_status text, _customer_message text default null, _picked_up_by_name text default null)`, returning `(order_id, history_id, customer_id, notify)`.
  - It requires `is_staff()`, and passes the message via `set_config('app.status_message', …, true)` before updating the orders.
  - An AFTER UPDATE OF status trigger (SECURITY DEFINER) writes `shipment_status_history(id, order_id, from_status, to_status, changed_by, changed_at, customer_message)`. The history table has no client write policies (append-only).
  - Customers read history rows of their own orders where the status is customer_visible.
  - The same RPC serves single and bulk changes. The calling server function then sends at most one email per customer per action (§35.12).
- **Shipments.** An optional staff-only consolidation batch (one flight or container).
  - Columns: `shipments(id, shipment_number unique, service_type, carrier, awb_or_container_number, departed_at, arrived_at, …)`.
  - "Status voor hele zending wijzigen" uses `change_order_status` with all of its orders.
  - Customers see a shipment only if one of their orders is in it.
- **Receiving (no scanner screen).**
  - `/admin/orders` has a prominent search box for a tracking number (normalised) or a GR code.
  - An "Ontvangen in US-magazijn" dialog sets measured_weight_lbs and moves the order to the us_warehouse stage.
  - If no order matches, staff create one for the customer (created_by_role 'staff').
  - If two orders share a normalised tracking number, warn and show both.
- **Pickup.**
  - Moving to a completed stage records picked_up_at, handed_over_by and picked_up_by_name.
  - If an invoice covering the order has a balance > 0 and `pay_before_pickup` is on [configurable, default true], show a blocking dialog that can be overridden only with a reason (audited).
  - Pickup details from settings appear on the "Klaar voor afhalen" card and the order page.
- **Documents.**
  - A private bucket `order-documents` (file_size_limit 10 MB; pdf/jpeg/png/webp/heic only; never svg or html), with path `{customer_id}/{order_id}/{uuid}.{ext}`.
  - storage.objects policies are per command and always start with `bucket_id = 'order-documents' and …`: customers SELECT/INSERT their own folder, staff everything, and no UPDATE.
  - Each file is recorded in `order_documents(id, order_id, customer_id, kind, storage_path unique, original_filename, mime_type, size_bytes, uploaded_by, created_at)`.
  - Downloads only via `createSignedUrl(path, 300)`.
- **Recent activity** for dashboards is derived from status history, invoices and payments. There is no separate notifications table in v1.

## 35.8 Admin settings `/admin/instellingen` (never hardcoded)
Settings are readable by authenticated users and writable by admins only. Every change is audited. A missing value shows "Nog niet ingesteld", and the admin dashboard shows a setup checklist.
- **`company_settings` (singleton).** Seeded from the template:
  - company_name 'G&R SOLUTIONS N.V.', tagline 'CUSTOMS BROKERAGE & LOGISTICS'
  - email 'info@grsolutions.sr', phone '5978897500', address 'kwattaweg #22', kkf_number null, btw_number null
  - invoice_title 'INVOICE (inclusief BTW)', footer_text 'G&R SOLUTIONS N.V.  |  CUSTOMS BROKERAGE & LOGISTICS', payment_terms_text (the template text verbatim)
  - payment_term_days 7, late_fee_percent 15
  - due_soon_days 2, overdue_reminder_interval_days 7, max_overdue_reminders 3
  - default_currency 'USD', vat_rate_percent null, show_vat_breakdown false
  - invoice_number_prefix 'INV-', paper_size 'Letter' (Letter|A4)
  - public_signup_enabled true, pay_before_pickup true, delivery_available false
  - pickup_address 'Kwattaweg #22, Paramaribo', pickup_hours null, pickup_instructions 'Neem een geldig legitimatiebewijs en uw klantcode mee'
  - terms_markdown and prohibited_goods_markdown: placeholders only; never generate legal text
- **`company_bank_accounts`.** Columns: currency ('USD','EUR','SRD'), bank_name, account_holder, account_number, sort_order, is_active. Seed three EMPTY rows. While one is empty, show "Bankgegevens ontbreken – vul ze in bij Instellingen" on the dashboard and above the invoice preview.
- **`warehouse_addresses`** (the US shipping address, refines §3).
  - Columns: label, service_type, recipient_name_template default '{FULL_NAME} {GR_CODE}', address_line1, address_line2_template default '{GR_CODE}', city, state, zip, country, phone, is_active. Do NOT invent or seed an address [owner to confirm].
  - **The customer dashboard's first card is "Uw persoonlijk US-verzendadres"**, filled with the customer's name and GR code. It has copy buttons and the note "Zet altijd uw klantcode {GR_CODE} achter uw naam én op adresregel 2." Until an address exists it shows "Ons US-adres wordt binnenkort hier getoond."
- **`service_rates`.** Columns: service_type pk ('air','sea'), enabled (air true, sea false), rate_per_lb null, currency 'USD', minimum_billable_lbs null, weight_rounding ('none','0.1','0.5','1', always rounding up).

## 35.9 Invoices (refines §14, §16, §17)
- **Lines replace the separate charge fields of §14.** The template prices weight × rate per lb.
- **`invoice_items` columns.** id, invoice_id, order_id null, `line_type` ('freight','customs','handling','goods','service_fee','other','discount','late_fee'), description not null, weight_lbs null, rate_per_lb null, amount not null, vat_exempt (default true for customs), sort_order.
- **Checks.**
  - freight: weight > 0, rate ≥ 0, amount = round(weight × rate, 2).
  - Other line types: weight and rate are NULL.
  - discount: amount ≤ 0. All other types: amount ≥ 0.
  - At most one late_fee line per invoice.
- **Order rule.** An order may have at most ONE freight line across all non-cancelled invoices (enforced by a trigger). Other line types may reference an already-invoiced order, so a separate SRD customs invoice for the same order is allowed. An order_id must belong to the invoice's customer.
- **Builder `/admin/facturen/nieuw`.** Opened from "Genereer factuur" on orders, customers and the order list.
  1. Pick a customer, then one or more of their orders. Orders without a freight line are listed by default; a toggle shows already-invoiced orders.
  2. One freight line per order is prefilled:
     - description '{store_vendor} – order {vendor_order_number}', with a small second line 'Tracking: … · Ref: …';
     - weight = measured weight after rounding and minimum (if missing, the declared weight, flagged);
     - rate from service_rates.
  3. Add or remove any other lines.
  4. Choose "Opslaan als concept" or "Genereer factuur" (which saves the draft, then issues it).
- **Totals.**
  - A trigger on invoice_items recomputes invoices.total_lbs, subtotal_freight, total_charges, total_discount, total_amount (≥ 0) and vat_amount.
  - One pure TS function `computeInvoiceTotals(lines)` drives the live preview, with vitest tests proving it matches the SQL. Client-sent totals are ignored. Round half-up to 2 decimals.
- **`invoices` columns.** invoice_number unique null, customer_id, currency ('USD','EUR','SRD'), invoice_date, due_date, status ('draft','open','partially_paid','paid','cancelled'), the totals, vat_rate, vat_amount, customer_note, issuer_snapshot jsonb, bill_to_snapshot jsonb, issued_at, issued_by, paid_at, cancelled_at, cancelled_by, cancel_reason (customer-visible), replaces_invoice_id, first_reminder_sent_at, last_reminder_sent_at, reminder_count, late_fee_applied_at, plus created_* and updated_*.
- **Dates.** invoice_date = today in Suriname; due_date = invoice_date + payment_term_days. Both are editable on drafts.
- **Numbering.**
  - Drafts have no number and show "CONCEPT".
  - The guarded staff RPC `issue_invoice(_invoice_id)` runs in one transaction:
    1. Lock the invoice and require status draft with at least one line.
    2. Recompute totals.
    3. Take a gapless number from `invoice_number_counters(year, last_number)` via an upsert. Format `{prefix}{YYYY}-{NNNN}`, e.g. INV-2026-0001.
    4. Set status 'open', issued_at and issued_by, and write both snapshots.
  - The admin RPC `set_invoice_counter(year, last_number)` lets G&R continue its current numbering; it is refused once that year already has an issued invoice.
- **Snapshots.** `bill_to_snapshot` holds the customer's name, code, company, address and email. `issuer_snapshot` holds the company fields, bank accounts, terms, title, footer, VAT settings and paper size. Issued invoices ALWAYS render from the snapshots; drafts render from live settings.
- **Immutability.**
  - Once status ≠ draft, triggers reject changes to lines, amounts, currency, customer, dates, number and snapshots.
  - Still allowed: payment-driven status changes, cancel (admin, with a reason), reminder bookkeeping, and the late fee. `apply_late_fee` sets `set_config('app.invoice_mutation','late_fee',true)`; while that flag is set, the triggers allow inserting one late_fee line and recomputing the totals.
  - Corrections: cancel, then issue a new invoice with `replaces_invoice_id`. Issued invoices are never deleted; drafts can be.
- **Visibility.** The customer policy is `customer_id = current_customer_id() and status <> 'draft'`. invoice_items and payments follow the same rule.

## 35.10 Currency, BTW, payments, overdue, late fee (refines §17, §19)
- **Currency.**
  - Each invoice has ONE currency (default USD). There is no automatic FX conversion.
  - `formatMoney(amount, currency)` produces 'USD 1.234,56'; weights print as '12,50 lbs'; dates as dd-mm-jjjj.
  - All totals and KPIs are grouped PER CURRENCY ("Openstaand: USD 245,00 · SRD 1.250,00"). Never add different currencies together.
- **BTW.** "INVOICE (inclusief BTW)": prices are entered INCLUDING BTW, and tax is never added on top.
  - If vat_rate_percent is set: vat_amount = round(sum of non-exempt lines × rate / (100 + rate), 2).
  - If show_vat_breakdown is on: print "Waarvan BTW ({rate}%)" under "Totaal prijs".
  - [owner to confirm; default: no breakdown]
- **Payments.**
  - Columns: `payments(id, invoice_id, amount > 0 in the invoice currency, paid_on date, method ('bank_transfer','cash','pin','mobile','other'), reference, received_amount null, received_currency null, customer_note, recorded_by, created_at, voided_at, voided_by, void_reason)`.
  - Staff insert payments. Payments are never updated or deleted; voiding is the admin RPC `void_payment(id, reason)`. Payments on cancelled invoices are rejected.
  - A trigger derives the invoice status: non-voided total ≥ invoice total → 'paid' (with paid_at); > 0 → 'partially_paid'; 0 → 'open'.
  - "Markeer als betaald" records one payment for the full balance.
- **Overdue is computed, never stored.** The view `invoice_overview` provides amount_paid, balance_due, is_overdue (status open/partially_paid, due_date < today in Suriname, balance > 0) and days_overdue. Every badge and count reads from it.
  - Customer badges: Openstaand, Deels betaald, Betaald, Achterstallig, Geannuleerd. Always text plus icon, never colour alone.
- **Late fee (template: 15% after 1 week).** On overdue invoices, an admin can click "Opslag 15% toepassen". The guarded RPC `apply_late_fee(invoice_id)` adds one late_fee line = round(balance × late_fee_percent / 100, 2); it is audited. It is not automatic in v1.
- **Payment instruction.** Printed under BETALINGSGEGEVENS and in emails: "Factuurvaluta: {currency} · Vermeld bij betaling: {invoice_number} / {customer_code}".

## 35.11 Invoice document: exact template reproduction (refines §15, §18)
- **One renderer.** `InvoiceDocument({ model })` is used by the live preview (built from form state), the admin and customer invoice pages, and the print routes (built from row plus snapshots). It uses the exact template hex values below; the app design tokens do not apply inside it.
- **Look.** Inter (fallback Calibri, Arial), body 11pt, colour #1F1B18. Brown #713A28, cream #F5F2EC, borders #D8D2C9, footer grey #777777. Square corners, collapsed borders; no shadows, gradients, icons or extra colours.
- **Blocks, top to bottom.** Dutch labels verbatim; never "FACTUUR" or "Factuurnummer".
  1. **Logo band.** Full-width #EEEBE4 band, at most 1.9in tall, with the logo centred (contain).
  2. **Title.** invoice_title, 26pt bold #713A28, centred.
  3. **Contact lines.** "Email: …", "Telefoon: …", "Adres: …": centred, 10pt bold #713A28. A 4th line "KKF: … · BTW-nr: …" only when filled.
  4. **Info table.**
     - 4 columns, 16/34/16/34%. Every cell has a 0.75pt #D8D2C9 border.
     - Label cells: #F5F2EC fill, 8.5pt bold #713A28.
     - Row 1: "Naam klant:" | "Unieke code:".
     - Row 2: "Datum:" | "Invoicenummer:" (the number, or CONCEPT).
     - Row 3 (added): "Vervaldatum:" | "Referentie:" (order references).
  5. **Items table.**
     - 3 columns, 54/22/24%.
     - Header: #713A28 fill, bold white. "Items" left-aligned; "Gewicht" and "Prijs per lbs" centred.
     - Only freight lines appear as item rows: the description plus a small grey tracking/ref line, '12,50 lbs', 'USD 4,50'. Numbers right-aligned with tabular-nums.
     - Pad with empty bordered rows to at least 5.
  6. **Summary rows.** Cream label cell with a bold brown label.
     - "Totaal lbs": value in the Gewicht column.
     - Then, only when non-zero, with the amount in the last column: "Vrachtkosten" (only when other rows exist), "Inklaringskosten / douane", "Handlingkosten", "Goederen (aankoop)", "Servicekosten", "Overige kosten: {omschrijving}", "Opslag te late betaling", "Korting" (printed as '– USD 10,00').
     - Then "Totaal prijs", then the optional "Waarvan BTW".
     - A freight-only invoice therefore looks exactly like the template.
  7. **Opmerkingen.** "OPMERKINGEN" with customer_note, only when not empty.
  8. **Betalingsgegevens.** "BETALINGSGEGEVENS" (bold brown), then a 3-column table.
     - Cream header: "USD – Dollar" | "EUR – Euro" | "SRD".
     - Rows: "Rekeningnummer:" and "Bank:". An empty value prints "________________".
     - Then the payment instruction line.
  9. **Betalingsvoorwaarden.** "BETALINGSVOORWAARDEN", then payment_terms_text in bold.
  10. **Footer.** footer_text, 7.5pt #777777, centred, on EVERY printed page.
- **Status marks on the paper.**
  - Draft: a light diagonal "CONCEPT" watermark.
  - Paid: a brown outline stamp "BETAALD dd-mm-jjjj".
  - Cancelled: a "GEANNULEERD" watermark.
  - The app badge sits outside the paper.
- **Page.**
  - `@page { size: letter | A4; margin: 0.45in 0.55in }`; up to 8 lines fit on one page.
  - Repeat the items table header on later pages; keep the summary, payment block and terms together.
  - `print-color-adjust: exact` (otherwise browsers drop the fills). Hide all app chrome when printing.
- **Live preview.** Rendered at true paper size and scaled with `transform: scale()`; never reflowed. Below 1024px, use tabs "Gegevens" | "Voorbeeld".
- **PDF.** `/portal/facturen/$id/print` and `/admin/facturen/$id/print` render only InvoiceDocument.
  - Call `window.print()` ("Opslaan als PDF") after `document.fonts.ready` and the logo have loaded.
  - Set `document.title` to '{invoice_number} - G&R Solutions'.
  - No Puppeteer, html2canvas or jsPDF.

## 35.12 Email, WhatsApp sharing, reminders (refines §19, §24)
- **Email is sent ONLY from server code, after the DB write commits. Never from SQL.** No pg_net/http calls to Resend, no database webhooks. Each server function does its DB write with `context.supabase`, then calls `sendEmail()` from `src/server/email.ts`:
  - `registerOrderFn` → "order bevestigd";
  - `changeOrderStatusFn` (calls the RPC) → "statusupdate", only where notify is true;
  - `issueInvoiceFn` (calls `issue_invoice`) → "factuur aangemaakt";
  - `recordPaymentFn` / `markPaidFn` → "betaling ontvangen" when the status became paid;
  - `inviteCustomerFn` / `resendInvitationFn` → "uitnodiging";
  - after redemption → "welkom" (with the personal US address).
- **sendEmail.**
  - Calls the Resend REST API via fetch with an `Idempotency-Key`. From: EMAIL_FROM. Reply-to: EMAIL_REPLY_TO, falling back to company_settings.email.
  - Without config it logs `skipped_no_provider` and never throws. Admin pages show "E-mail is nog niet geconfigureerd".
- **`email_logs`.**
  - Columns: id, kind, customer_id, invoice_id, order_id, recipient, idempotency_key unique, status ('queued','sent','failed','skipped_no_provider'), provider_message_id, error, created_at, sent_at. Staff-only RLS; FKs use `on delete set null`.
  - Claim before sending (insert … on conflict do nothing). A row with status 'failed' may be re-claimed.
- **Customers without a login (user_id null).** Emails must not link to `/portal`. Include the details in the email, plus the invite link if an invitation is open. Admin invoice pages have "Download PDF".
- **"Deel via WhatsApp".** No API and no secret: build `https://wa.me/<phone digits, 597 prefix>?text=<encoded Dutch message + link>`. Use it for issued invoices, status-change results, reminder rows and invite links. This is the main channel until Resend is configured.
- **Templates.** Branded HTML with the logo band and Dutch wording. Escape all customer text.
- **Reminders.**
  - One idempotent function, `runPaymentReminders({ trigger: 'cron' | 'manual' })`, in `src/server/reminders.ts`. For invoices that are open or partially paid, using windows rather than exact days:
    - due_soon when `due_date - due_soon_days <= today < due_date` and not yet sent;
    - overdue when `today > due_date` and reminder_count = 0;
    - repeat when `today >= last_reminder_sent_at::date + interval` and count < max.
  - It updates first_reminder_sent_at, last_reminder_sent_at and reminder_count, and writes a `job_runs` row.
  - **Endpoint:** `src/routes/api/cron/payment-reminders.ts` requires `Authorization: Bearer <CRON_SECRET>`, compared as sha256 digests with timingSafeEqual (via `await import('node:crypto')`). Returns 401 on a mismatch and 500 if unset. Takes no parameters from the request.
  - **Scheduler:** Supabase pg_cron + pg_net, in a P8 migration. A SECURITY DEFINER function `private.invoke_payment_reminders()` reads `app_url` and `cron_secret` from Supabase Vault and POSTs to the endpoint daily at 12:00 UTC (09:00 Suriname). It quietly does nothing if the Vault secrets are missing. No secrets in the migration; DEPLOYMENT.md tells the owner to create the two Vault secrets.
  - **`/admin/herinneringen`:** "Herinneringen nu versturen" (runs the same function); per invoice "Herinnering nu versturen" (at most once per day); the last job run and the reminder history.

## 35.13 Audit log (refines §28)
- **Table.** `audit_log(id bigint identity, occurred_at, actor_id, table_name, record_id, action, old_data jsonb, new_data jsonb, changed_columns text[])`, indexed. Admin SELECT only; no client writes.
- **Writer.** One generic AFTER trigger in `private`, attached to customers, user_roles, invitations, orders, shipments, invoices, invoice_items, payments, company_settings, company_bank_accounts, warehouse_addresses, service_rates and shipment_statuses.
  - `actor_id = coalesce(auth.uid(), (to_jsonb(coalesce(new, old))->>'updated_by')::uuid, (to_jsonb(coalesce(new, old))->>'created_by')::uuid)`. Use `to_jsonb(old)` / `to_jsonb(new)`, so tables without updated_by work.
  - Strip token_hash from the stored JSON.
- **Readable Dutch timelines** only for: order status changes, invoice issued/cancelled/paid, payment recorded/voided, customer created/edited/disabled, and customer code assigned/changed. `/admin/audit` shows the generic log as a table with a JSON diff drawer.

## 35.14 App design system and logo (refines §2, §25, §33)
- **Tokens** in `src/styles.css` `:root`, as oklch. Light theme only.
  - background #FAF8F4; cards white; foreground #2B2724
  - primary #713A28 (hover #5A3122), white foreground
  - secondary/muted #F5F2EC with brown foreground; muted-foreground #6B645C
  - border #D8D2C9; input border #8F857A; ring = primary
  - brand grey #54514C; paper #EEEBE4 (only behind the logo)
  - radius 0.375rem
- **Status badge colours.**
  - Paid / ready for pickup: green `oklch(0.476 0.094 150.1)` on `oklch(0.951 0.016 154.5)`.
  - Open: amber `oklch(0.508 0.108 73.3)` on `oklch(0.960 0.030 85.6)`.
  - Overdue / destructive: red `oklch(0.500 0.182 29.5)` on `oklch(0.956 0.019 25.6)`.
  - In transit: slate `oklch(0.451 0.071 242.7)` on `oklch(0.945 0.012 239.9)`.
  - Draft / cancelled: grey.
- **Typography.** Montserrat 600/700 for headings; Inter 400/500/600 for UI; both self-hosted via @fontsource. Use tabular-nums for amounts, weights and codes.
- **Tables** echo the invoice: cream header with bold brown labels and #D8D2C9 lines. They become cards on mobile.
- **Avoid:** gradients, glassmorphism, purple/blue defaults, decorative animation.
- **Logo.** The attached JPEG is a photo on textured paper; no transparent version exists yet.
  - Save it as `public/brand/gr-logo-original.jpg`. Derive `gr-logo-banner.jpg` (cropped), `gr-monogram.jpg` (the GR mark on a square #EEEBE4 canvas) and favicons (replacing the Lovable favicon).
  - Every usage goes through `<BrandLogo variant='banner'|'monogram'|'lockup'>` with the paths in one config, so a PNG/SVG can replace them later.
  - Place the JPEG only on #EEEBE4 surfaces. Never stretch, recolour or redraw it.
  - Header lockup: monogram tile, then 'G&R SOLUTIONS N.V.' in Montserrat 700 brown, with 'CUSTOMS BROKERAGE & LOGISTICS' small in #54514C below it.
  - Save the template images as `docs/reference/invoice-template-p1.png` / `-p2.png` (not shipped).
- **Meta.** Title "G&R Activate | G&R Solutions N.V." (never "Lovable App").
- **Terms.** "Algemene voorwaarden" and "Verboden goederen" pages show settings content (placeholders for now). Signup requires accepting the terms. The order form requires the checkbox "Mijn zending bevat geen verboden goederen".

## 35.15 Tests and delivery docs (refines §23, §31)
- **vitest** for pure logic in `src/lib/*.ts`: invoice totals (half-up, BTW-inclusive split), GR-code normalisation, the invoice number format, due-soon and overdue windows in America/Paramaribo, and the email idempotency keys. Keep `src/test/app-routing.test.tsx` passing.
- **`supabase/tests/rls_checks.sql`** (`begin; … rollback;`, run by the owner in the SQL editor).
  - Setup: customers A and B, a disabled customer C, staff and admin users (fixed UUIDs, example.com emails). Impersonate each via `set local role authenticated` plus `request.jwt.claims`.
  - RAISE EXCEPTION if any of these hold:
    - A can see or change B's rows;
    - A can see drafts;
    - A can change their own code, status or user_id, insert an order for B, or set a status;
    - A can call any staff/admin RPC (expect SQLSTATE 42501);
    - A can read internal_notes, audit_log, invitations or email_logs;
    - anyone can modify an issued invoice;
    - C sees anything;
    - anon sees anything except company_settings.
- **`docs/ACCEPTANCE.md`.** Every §31 step as a checkbox with exact clicks and expected results, each marked "verified by me" or "needs owner test". Email steps are proven by email_logs rows and the copyable invite link.
- **`docs/DEPLOYMENT.md`.** Must cover:
  - Vercel env vars (Node 22, region iad1);
  - Lovable preview secrets;
  - the Supabase Auth URL configuration with EXACT redirect hosts (never `*.lovable.app` wildcards);
  - the "Confirm email" note;
  - Resend as custom SMTP and pasting the auth templates;
  - the Vault secrets;
  - the first-admin SQL;
  - the pre-go-live reset SQL;
  - the recommendation to upgrade to Supabase Pro and Vercel Pro before go-live.
- **"Exporteer CSV"** (admin): customers, orders, invoices with lines, payments, audit log.
- **History (§20).** Per-year aggregates come from a security_invoker view or RPC.

## 35.16 Out of scope for v1 (list under "Later" in PROGRESS.md)
- Payment-proof uploads by customers.
- Barcode receiving screen and unidentified-package registry.
- Automatic late fees.
- In-app notification inbox and order chat.
- Captcha and IP rate-limit tables.
- English UI.
- Several logins per business customer.
- Online card payments.
