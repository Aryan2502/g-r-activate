/**
 * Query keys of the admin area. Everything starts with ["admin", userId]
 * (cleared on sign-out). Everything about orders hangs under
 * [..., "orders"], so one invalidation after a status change, receipt or
 * pickup refreshes the list, the counts, the order page and its history.
 * Staff tasks live under [..., "tasks"]: cancelling an order resolves its
 * cancellation task, so writes on orders invalidate both.
 */
export const adminKeys = {
  all: (userId: string) => ["admin", userId] as const,
  profile: (userId: string) => ["admin", userId, "profile"] as const,
  customerCounts: (userId: string) => ["admin", userId, "customer-counts"] as const,
  /** Every shipment_statuses row (staff read all; admins edit them). */
  statuses: (userId: string) => ["admin", userId, "statuses"] as const,
  /** company_settings fields that steer operations (pickup, delivery). */
  settings: (userId: string) => ["admin", userId, "operational-settings"] as const,
  /** Display names of logins (profiles), for "door Maria". */
  people: (userId: string, ids: readonly string[]) =>
    ["admin", userId, "people", [...ids].sort().join(",")] as const,
  /**
   * Every customer (the picker of "Order aanmaken voor klant"). Everything
   * about customers hangs under it, so one invalidation after adding,
   * inviting, editing or disabling a customer refreshes the list, the
   * picker and the customer's page.
   */
  customers: (userId: string) => ["admin", userId, "customers"] as const,
  customerList: (userId: string) => ["admin", userId, "customers", "list"] as const,
  /** Open invitations by customer (status column of the list). */
  customerListInvitations: (userId: string) =>
    ["admin", userId, "customers", "list-invitations"] as const,
  /** Open invoice balances by customer (filter "Openstaande facturen"). */
  customerListInvoices: (userId: string) =>
    ["admin", userId, "customers", "list-invoices"] as const,
  /** The next generated GR number (peek_next_customer_number). */
  nextCustomerNumber: (userId: string) => ["admin", userId, "customers", "next-number"] as const,
  /** Who holds a GR number, for the live uniqueness check of "Klant toevoegen". */
  customerCodeHolder: (userId: string, code: string) =>
    ["admin", userId, "customers", "code", code] as const,
  /** One customer; like an order, the id has its own "id" segment. */
  customer: (userId: string, customerId: string) =>
    ["admin", userId, "customers", "id", customerId] as const,
  customerInvitations: (userId: string, customerId: string) =>
    ["admin", userId, "customers", "id", customerId, "invitations"] as const,
  customerNotes: (userId: string, customerId: string) =>
    ["admin", userId, "customers", "id", customerId, "notes"] as const,
  customerInvoices: (userId: string, customerId: string) =>
    ["admin", userId, "customers", "id", customerId, "invoices"] as const,
  customerAudit: (userId: string, customerId: string) =>
    ["admin", userId, "customers", "id", customerId, "audit"] as const,
  /**
   * The team page: members (team_members()) and open staff invitations. A
   * role change or (de)activation can revoke invitations, so both hang under
   * one key.
   */
  team: (userId: string) => ["admin", userId, "team"] as const,
  teamMembers: (userId: string) => ["admin", userId, "team", "members"] as const,
  teamInvitations: (userId: string) => ["admin", userId, "team", "invitations"] as const,
  /** What "Deactiveren" of a member would revoke (the dialog's list). */
  teamPendingBy: (userId: string, memberId: string) =>
    ["admin", userId, "team", "pending-by", memberId] as const,
  /**
   * Settings (/admin/instellingen) and what the dashboard derives from them
   * (setup checklist). Saving any section refreshes everything under it; the
   * operational settings of the order pages (`settings`) are refreshed too.
   */
  config: (userId: string) => ["admin", userId, "config"] as const,
  companySettings: (userId: string) => ["admin", userId, "config", "company"] as const,
  bankAccounts: (userId: string) => ["admin", userId, "config", "bank-accounts"] as const,
  warehouseAddresses: (userId: string) => ["admin", userId, "config", "warehouse"] as const,
  serviceRates: (userId: string) => ["admin", userId, "config", "rates"] as const,
  invoiceCounter: (userId: string, year: number) =>
    ["admin", userId, "config", "invoice-counter", year] as const,
  /** Booleans about the server's configuration (admins only, systemStatusFn). */
  systemStatus: (userId: string) => ["admin", userId, "config", "system-status"] as const,
  /** Whether e-mail is configured (every staff member, emailStatusFn). */
  emailStatus: (userId: string) => ["admin", userId, "config", "email-status"] as const,
  /** Dashboard figures that are not order counts. */
  dashboard: (userId: string) => ["admin", userId, "dashboard"] as const,
  customerStats: (userId: string) => ["admin", userId, "dashboard", "customers"] as const,
  invoiceStats: (userId: string) => ["admin", userId, "dashboard", "invoices"] as const,

  recentActivity: (userId: string) => ["admin", userId, "dashboard", "activity"] as const,
  tasks: (userId: string) => ["admin", userId, "tasks"] as const,
  openTasks: (userId: string, scope: "first" | "all" = "first") =>
    ["admin", userId, "tasks", "open", scope] as const,

  /**
   * Invoices (builder drafts, an invoice's page). Saving, issuing or deleting
   * an invoice also invalidates `orders` (billing columns, the builder's
   * order list), `customers` (a customer's invoices) and `dashboard`.
   */
  invoices: (userId: string) => ["admin", userId, "invoices"] as const,
  /** /admin/facturen: every invoice (invoice_overview) with its order references. */
  invoiceList: (userId: string) => ["admin", userId, "invoices", "list"] as const,
  invoice: (userId: string, invoiceId: string) =>
    ["admin", userId, "invoices", "id", invoiceId] as const,
  /** The e-mails about one invoice (email_logs: factuur, herinneringen, betaling ontvangen). */
  invoiceEmails: (userId: string, invoiceId: string) =>
    ["admin", userId, "invoices", "id", invoiceId, "emails"] as const,
  /** /admin/herinneringen: open invoices with settings and reminder log, and the job runs. */
  reminders: (userId: string) => ["admin", userId, "invoices", "reminders"] as const,
  reminderOverview: (userId: string) =>
    ["admin", userId, "invoices", "reminders", "overview"] as const,
  reminderRuns: (userId: string) => ["admin", userId, "invoices", "reminders", "runs"] as const,
  /** The payments of one invoice (voided ones too: staff see them). */
  invoicePayments: (userId: string, invoiceId: string) =>
    ["admin", userId, "invoices", "id", invoiceId, "payments"] as const,
  /** The invoice this one replaces and the invoices that replace it ("Corrigeren"). */
  invoiceRelations: (userId: string, invoiceId: string) =>
    ["admin", userId, "invoices", "id", invoiceId, "relations"] as const,
  /** The customer as the invoice prints them (address, KKF, …). */
  invoiceCustomer: (userId: string, customerId: string) =>
    ["admin", userId, "customers", "id", customerId, "bill-to"] as const,
  /** A customer's orders for the builder, with freight already billed elsewhere. */
  invoiceBuilderOrders: (userId: string, customerId: string, invoiceId: string | null) =>
    ["admin", userId, "orders", "invoice-builder", customerId, invoiceId ?? "new"] as const,

  orders: (userId: string) => ["admin", userId, "orders"] as const,
  orderList: (userId: string) => ["admin", userId, "orders", "list"] as const,
  orderBilling: (userId: string) => ["admin", userId, "orders", "billing"] as const,
  cancellationTasks: (userId: string) => ["admin", userId, "orders", "cancellation-tasks"] as const,
  orderCounts: (userId: string) => ["admin", userId, "orders", "counts"] as const,
  /** Dashboard: orders registered in the last 30 days and running orders. */
  orderStats: (userId: string) => ["admin", userId, "orders", "stats"] as const,
  /** Orders per customer (the customer list's "Orders" column). */
  ordersPerCustomer: (userId: string) => ["admin", userId, "orders", "per-customer"] as const,
  /** One customer's orders and their documents (customer page); refreshed with every order change. */
  customerOrders: (userId: string, customerId: string) =>
    ["admin", userId, "orders", "customer", customerId] as const,
  customerDocuments: (userId: string, customerId: string) =>
    ["admin", userId, "orders", "customer", customerId, "documents"] as const,
  /**
   * One order. The id sits behind its own "id" segment, so a URL such as
   * /admin/orders/list can never share a key (and cached data) with the list.
   */
  order: (userId: string, orderId: string) => ["admin", userId, "orders", "id", orderId] as const,
  orderHistory: (userId: string, orderId: string) =>
    ["admin", userId, "orders", "id", orderId, "history"] as const,
  orderDocuments: (userId: string, orderId: string) =>
    ["admin", userId, "orders", "id", orderId, "documents"] as const,
  orderInvoices: (userId: string, orderId: string) =>
    ["admin", userId, "orders", "id", orderId, "invoices"] as const,
  orderNotes: (userId: string, orderId: string) =>
    ["admin", userId, "orders", "id", orderId, "notes"] as const,
  orderTasks: (userId: string, orderId: string) =>
    ["admin", userId, "orders", "id", orderId, "tasks"] as const,
  orderGroup: (userId: string, rootId: string) =>
    ["admin", userId, "orders", "group", rootId] as const,
  /** Documents and unpaid invoices of a selection, for the status dialog's checks. */
  selectionChecks: (userId: string, orderIds: readonly string[], kind: string) =>
    ["admin", userId, "orders", "checks", kind, [...orderIds].sort().join(",")] as const,
  /**
   * Shipments hang under orders too: adding or removing orders and a status
   * change for a whole shipment refresh both sides with one invalidation.
   */
  shipments: (userId: string) => ["admin", userId, "orders", "shipments"] as const,
  shipmentList: (userId: string) => ["admin", userId, "orders", "shipments", "list"] as const,
  /** Which orders sit in which shipment (counts on the shipment list). */
  shipmentMembers: (userId: string) => ["admin", userId, "orders", "shipments", "members"] as const,
  /** One shipment; like an order, the id has its own "id" segment. */
  shipment: (userId: string, shipmentId: string) =>
    ["admin", userId, "orders", "shipments", "id", shipmentId] as const,
  shipmentOrders: (userId: string, shipmentId: string) =>
    ["admin", userId, "orders", "shipments", "id", shipmentId, "orders"] as const,
  /** Orders per status code (the statuses page: what is in use). */
  statusUsage: (userId: string) => ["admin", userId, "orders", "status-usage"] as const,

  /** /admin/audit: audit_log (admins only), one page per filter set. */
  audit: (userId: string) => ["admin", userId, "audit"] as const,
  auditPage: (userId: string, filters: Readonly<Record<string, unknown>>, page: number) =>
    ["admin", userId, "audit", filters, page] as const,
};
