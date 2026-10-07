import { describe, expect, it } from "vitest";

import { adminKeys } from "./keys";

const user = "u1";
const fixedOrderKeys = [
  adminKeys.orderList(user),
  adminKeys.orderBilling(user),
  adminKeys.cancellationTasks(user),
  adminKeys.orderCounts(user),
  adminKeys.shipments(user),
  adminKeys.shipmentList(user),
  adminKeys.shipmentMembers(user),
  adminKeys.statusUsage(user),
];
const same = (a: readonly unknown[], b: readonly unknown[]) =>
  JSON.stringify(a) === JSON.stringify(b);

describe("adminKeys", () => {
  it("an id from the URL never lands on a list's key (/admin/orders/list, /admin/zendingen/list)", () => {
    for (const id of ["list", "billing", "counts", "shipments", "members", "status-usage"]) {
      const perId = [
        adminKeys.order(user, id),
        adminKeys.orderHistory(user, id),
        adminKeys.shipment(user, id),
        adminKeys.shipmentOrders(user, id),
      ];
      for (const key of perId) {
        expect(
          fixedOrderKeys.some((fixed) => same(fixed, key)),
          `${id}: ${key.join("/")}`,
        ).toBe(false);
      }
    }
  });

  it("a customer id from the URL never lands on a customer list key (/admin/klanten/list)", () => {
    const fixed = [
      adminKeys.customerList(user),
      adminKeys.customerListInvitations(user),
      adminKeys.customerListInvoices(user),
      adminKeys.nextCustomerNumber(user),
    ];
    for (const id of ["list", "list-invitations", "list-invoices", "next-number", "code"]) {
      for (const key of [
        adminKeys.customer(user, id),
        adminKeys.customerInvitations(user, id),
        adminKeys.customerNotes(user, id),
      ]) {
        expect(
          fixed.some((f) => same(f, key)),
          `${id}: ${key.join("/")}`,
        ).toBe(false);
      }
    }
  });

  it("everything about customers hangs under customers; their orders and documents under orders", () => {
    const id = "6f1c0d2e-8a4b-4c3d-9e5f-0a1b2c3d4e5f";
    const customers = adminKeys.customers(user);
    for (const key of [
      adminKeys.customerList(user),
      adminKeys.customerListInvitations(user),
      adminKeys.customerListInvoices(user),
      adminKeys.nextCustomerNumber(user),
      adminKeys.customerCodeHolder(user, "GR00017"),
      adminKeys.customer(user, id),
      adminKeys.customerInvitations(user, id),
      adminKeys.customerNotes(user, id),
      adminKeys.customerInvoices(user, id),
      adminKeys.customerAudit(user, id),
    ]) {
      expect(key.slice(0, customers.length)).toEqual([...customers]);
    }
    const orders = adminKeys.orders(user);
    for (const key of [
      adminKeys.ordersPerCustomer(user),
      adminKeys.customerOrders(user, id),
      adminKeys.customerDocuments(user, id),
    ]) {
      expect(key.slice(0, orders.length)).toEqual([...orders]);
    }
  });

  it("everything about orders and shipments hangs under orders (one invalidation)", () => {
    const prefix = adminKeys.orders(user);
    const id = "6f1c0d2e-8a4b-4c3d-9e5f-0a1b2c3d4e5f";
    for (const key of [
      ...fixedOrderKeys,
      adminKeys.order(user, id),
      adminKeys.orderHistory(user, id),
      adminKeys.shipment(user, id),
      adminKeys.shipmentOrders(user, id),
    ]) {
      expect(key.slice(0, prefix.length)).toEqual([...prefix]);
    }
    expect(adminKeys.shipmentList(user).slice(0, 4)).toEqual([...adminKeys.shipments(user)]);
  });

  it("team, settings and dashboard figures hang under one key each (one invalidation)", () => {
    const team = adminKeys.team(user);
    for (const key of [adminKeys.teamMembers(user), adminKeys.teamInvitations(user)]) {
      expect(key.slice(0, team.length)).toEqual([...team]);
    }
    const config = adminKeys.config(user);
    for (const key of [
      adminKeys.companySettings(user),
      adminKeys.bankAccounts(user),
      adminKeys.warehouseAddresses(user),
      adminKeys.serviceRates(user),
      adminKeys.invoiceCounter(user, 2026),
      adminKeys.systemStatus(user),
    ]) {
      expect(key.slice(0, config.length)).toEqual([...config]);
    }
    const dashboard = adminKeys.dashboard(user);
    for (const key of [
      adminKeys.customerStats(user),
      adminKeys.invoiceStats(user),
      adminKeys.recentActivity(user),
    ]) {
      expect(key.slice(0, dashboard.length)).toEqual([...dashboard]);
    }
    // Running orders change with every order write: they refresh with the orders.
    const orders = adminKeys.orders(user);
    expect(adminKeys.orderStats(user).slice(0, orders.length)).toEqual([...orders]);
    // The order pages' operational settings are a separate key: settings pages refresh both.
    expect(same(adminKeys.settings(user).slice(0, 3), config)).toBe(false);
  });

  it("an invoice id from the URL never lands on the invoice list's key (/admin/facturen/list)", () => {
    for (const id of ["list", "payments", "relations"]) {
      expect(same(adminKeys.invoice(user, id), adminKeys.invoiceList(user))).toBe(false);
    }
    // Payments and relations hang under their invoice; everything under "invoices".
    const id = "6f1c0d2e-8a4b-4c3d-9e5f-0a1b2c3d4e5f";
    const invoice = adminKeys.invoice(user, id);
    for (const key of [adminKeys.invoicePayments(user, id), adminKeys.invoiceRelations(user, id)]) {
      expect(key.slice(0, invoice.length)).toEqual([...invoice]);
    }
    const invoices = adminKeys.invoices(user);
    expect(adminKeys.invoiceList(user).slice(0, invoices.length)).toEqual([...invoices]);
  });
});
