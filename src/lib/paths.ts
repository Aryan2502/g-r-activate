// App paths shared across areas. Typed as plain strings so <Link to={paths.x}>
// compiles regardless of which phase adds the target route.
export const paths: Readonly<
  Record<
    | "home"
    | "login"
    | "signup"
    | "forgotPassword"
    | "authConfirm"
    | "setPassword"
    | "portal"
    | "portalProfile"
    | "portalOrders"
    | "portalOrderNew"
    | "portalInvoices"
    | "admin"
    | "adminOrders"
    | "adminOrderNew"
    | "adminShipments"
    | "adminStatuses"
    | "adminCustomers"
    | "adminTeam"
    | "adminSettings"
    | "adminInvoices"
    | "adminInvoiceNew",
    string
  >
> = {
  home: "/",
  login: "/login",
  signup: "/registreren",
  forgotPassword: "/wachtwoord-vergeten",
  authConfirm: "/auth/confirm",
  setPassword: "/auth/set-password",
  portal: "/portal",
  portalProfile: "/portal/profiel",
  portalOrders: "/portal/orders",
  /** Order registration; `?parent=<order id>` adds an extra package (see newOrderSearchSchema). */
  portalOrderNew: "/portal/orders/nieuw",
  /** The customer's invoices; `/portal/facturen/<id>` is one invoice (never a draft). */
  portalInvoices: "/portal/facturen",
  admin: "/admin",
  adminOrders: "/admin/orders",
  /** "Order aanmaken voor klant"; `?customer=`, `?parent=` and `?tracking=` prefill it. */
  adminOrderNew: "/admin/orders/nieuw",
  /** Shipments (consolidation batches); `/admin/zendingen/<id>` is one shipment. */
  adminShipments: "/admin/zendingen",
  /** Order statuses: staff read, admins edit. */
  adminStatuses: "/admin/statussen",
  /** Customers; `/admin/klanten/<id>` is one customer's page. */
  adminCustomers: "/admin/klanten",
  /** Staff and admins: admins invite, change roles, deactivate; staff read. */
  adminTeam: "/admin/team",
  /** Settings (SPEC §35.8): admins edit, staff read. `#<section id>` jumps to a section. */
  adminSettings: "/admin/instellingen",
  /** Invoices (search, filters, totals per currency); `/admin/facturen/<id>` is one invoice (a draft opens the builder). */
  adminInvoices: "/admin/facturen",
  /** The invoice builder; `?customer=<id>&orders=<id,id>` prefills it (SPEC §35.9). */
  adminInvoiceNew: "/admin/facturen/nieuw",
};
