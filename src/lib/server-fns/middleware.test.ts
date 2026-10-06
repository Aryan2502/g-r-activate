import { describe, expect, it, vi } from "vitest";

import { t } from "@/lib/i18n";

import { ForbiddenError, assertRole } from "./middleware";

function client(result: { data: unknown; error: unknown }) {
  const rpc = vi.fn(() => Promise.resolve(result));
  return { rpc } as unknown as Parameters<typeof assertRole>[0] & { rpc: typeof rpc };
}

describe("assertRole()", () => {
  it("calls is_staff() / is_admin() with the caller's own client", async () => {
    const staff = client({ data: true, error: null });
    await expect(assertRole(staff, "staff")).resolves.toBeUndefined();
    expect(staff.rpc).toHaveBeenCalledWith("is_staff");

    const admin = client({ data: true, error: null });
    await assertRole(admin, "admin");
    expect(admin.rpc).toHaveBeenCalledWith("is_admin");
  });

  it("throws a 403 with SQLSTATE 42501 when the role is missing", async () => {
    const error = await assertRole(client({ data: false, error: null }), "admin").catch((e) => e);
    expect(error).toBeInstanceOf(ForbiddenError);
    expect(error).toMatchObject({ status: 403, code: "42501", message: t("apiError.forbidden") });
  });

  it("treats anything but true as no access", async () => {
    await expect(assertRole(client({ data: null, error: null }), "staff")).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("fails closed, but not as 403, when the check itself errors", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const error = await assertRole(
      client({ data: null, error: { message: "timeout" } }),
      "staff",
    ).catch((e) => e);
    expect(error).not.toBeInstanceOf(ForbiddenError);
    expect(error.message).toBe(t("apiError.roleCheckFailed"));
  });
});
