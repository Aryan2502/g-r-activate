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
});
