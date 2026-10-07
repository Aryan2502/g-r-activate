import { describe, expect, it } from "vitest";

import { onOrderRegistered, onOrderStatusChanged } from "./order-notifications";

describe("order e-mail hooks (P8)", () => {
  it("onOrderRegistered resolves without sending anything until P8 adds the e-mail", async () => {
    await expect(
      onOrderRegistered({
        orderId: "a0000000-0000-4000-8000-000000000001",
        reference: "ORD-2026-00001",
        customerId: "c0c0c0c0-0000-4000-8000-000000000001",
        parentOrderId: null,
        userId: "11111111-1111-4111-8111-111111111111",
        createdBy: "customer",
      }),
    ).resolves.toBeUndefined();
  });

  it("onOrderStatusChanged resolves without sending anything until P8 adds the e-mail", async () => {
    await expect(
      onOrderStatusChanged({
        action: "status",
        toStatus: "in_transit",
        customerMessage: null,
        emails: [
          {
            customerId: "c0c0c0c0-0000-4000-8000-000000000001",
            orderIds: ["a0000000-0000-4000-8000-000000000001"],
            historyIds: [41],
          },
        ],
        userId: "99999999-9999-4999-8999-999999999999",
      }),
    ).resolves.toBeUndefined();
  });
});
