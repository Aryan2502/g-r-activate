import { describe, expect, it } from "vitest";

import { onOrderRegistered } from "./order-notifications";

describe("onOrderRegistered() (P8 hook)", () => {
  it("resolves without sending anything until P8 adds the e-mail", async () => {
    await expect(
      onOrderRegistered({
        orderId: "a0000000-0000-4000-8000-000000000001",
        reference: "ORD-2026-00001",
        customerId: "c0c0c0c0-0000-4000-8000-000000000001",
        parentOrderId: null,
        userId: "11111111-1111-4111-8111-111111111111",
      }),
    ).resolves.toBeUndefined();
  });
});
