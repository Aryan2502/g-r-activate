import { describe, expect, it } from "vitest";

import { getRole } from "./roles";

type RpcResult = { data: boolean | null; error: { message: string } | null };

function fakeClient(results: Record<string, RpcResult>) {
  const calls: string[] = [];
  const client = {
    rpc: (fn: string) => {
      calls.push(fn);
      return Promise.resolve(results[fn] ?? { data: null, error: { message: "unknown fn" } });
    },
  };
  return { client: client as unknown as Parameters<typeof getRole>[0], calls };
}

describe("getRole()", () => {
  it("asks the database, never the token", async () => {
    const { client, calls } = fakeClient({
      is_admin: { data: false, error: null },
      is_staff: { data: false, error: null },
    });
    await expect(getRole(client)).resolves.toBe("customer");
    expect(calls.sort()).toEqual(["is_admin", "is_staff"]);
  });

  it("returns admin before staff", async () => {
    const admin = fakeClient({
      is_admin: { data: true, error: null },
      is_staff: { data: true, error: null },
    });
    await expect(getRole(admin.client)).resolves.toBe("admin");
    const staff = fakeClient({
      is_admin: { data: false, error: null },
      is_staff: { data: true, error: null },
    });
    await expect(getRole(staff.client)).resolves.toBe("staff");
  });

  it("throws when a check fails instead of guessing", async () => {
    const { client } = fakeClient({
      is_admin: { data: null, error: { message: "network" } },
      is_staff: { data: true, error: null },
    });
    await expect(getRole(client)).rejects.toMatchObject({ message: "network" });
  });
});
