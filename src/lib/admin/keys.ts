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
  customers: (userId: string) => ["admin", userId, "customers"] as const,
  tasks: (userId: string) => ["admin", userId, "tasks"] as const,
  openTasks: (userId: string, scope: "first" | "all" = "first") =>
    ["admin", userId, "tasks", "open", scope] as const,

  orders: (userId: string) => ["admin", userId, "orders"] as const,
  orderList: (userId: string) => ["admin", userId, "orders", "list"] as const,
  orderBilling: (userId: string) => ["admin", userId, "orders", "billing"] as const,
  cancellationTasks: (userId: string) => ["admin", userId, "orders", "cancellation-tasks"] as const,
  orderCounts: (userId: string) => ["admin", userId, "orders", "counts"] as const,
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
};
