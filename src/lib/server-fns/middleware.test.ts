import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { t } from "@/lib/i18n";

import { ForbiddenError, assertRole, checkRole, denied, resolveAccess } from "./middleware";

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

describe("checkRole() / resolveAccess(): the refusal as data (return-as-data pattern)", () => {
  it("returns null for the role, and the 42501 failure (never thrown) without it", async () => {
    await expect(checkRole(client({ data: true, error: null }), "staff")).resolves.toBeNull();
    await expect(checkRole(client({ data: false, error: null }), "staff")).resolves.toEqual({
      message: t("apiError.forbidden"),
      code: "42501",
      hint: null,
    });
  });

  it("a failing check is 'could not check', without a code", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      checkRole(client({ data: null, error: { message: "timeout" } }), "admin"),
    ).resolves.toEqual({ message: t("apiError.roleCheckFailed"), code: null, hint: null });
  });

  it("hands the caller's client to the handler only after the check passed", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const supabase = client({ data: true, error: null });
    const ok = await resolveAccess(
      { supabase, userId: "u1" } as unknown as Parameters<typeof resolveAccess>[0],
      "staff",
    );
    expect(ok).toMatchObject({ ok: true, role: "staff", userId: "u1" });
    expect(ok.ok && ok.supabase).toBe(supabase);

    const refused = await resolveAccess(
      { supabase: client({ data: false, error: null }), userId: "u2" } as unknown as Parameters<
        typeof resolveAccess
      >[0],
      "admin",
    );
    expect(refused).toEqual({
      ok: false,
      error: { message: t("apiError.forbidden"), code: "42501", hint: null },
    });
    expect(refused).not.toHaveProperty("supabase");
    if (!refused.ok) {
      expect(denied(refused)).toEqual({ ok: false, error: refused.error });
    }
  });
});

describe("privileged handlers (*.functions.ts)", () => {
  const dir = path.dirname(new URL(import.meta.url).pathname);
  const files = readdirSync(dir).filter((f) => f.endsWith(".functions.ts"));

  /** Each server function that runs requireStaff/requireAdmin, with the start of its handler. */
  function privilegedHandlers() {
    const found: { file: string; start: string }[] = [];
    for (const file of files) {
      const source = readFileSync(path.join(dir, file), "utf8");
      for (const chunk of source.split("createServerFn(").slice(1)) {
        if (!/\.middleware\(\[[^\]]*\b(requireStaff|requireAdmin)\b/.test(chunk)) continue;
        const body = chunk.slice(chunk.indexOf(".handler("));
        const start = body.slice(body.indexOf("{", body.indexOf("=>")) + 1);
        found.push({ file, start: start.replace(/\s+/g, " ").trim().slice(0, 120) });
      }
    }
    return found;
  }

  it("each one starts with the role check and returns its refusal as data", () => {
    const handlers = privilegedHandlers();
    // Four staff actions today (status, pickup, receive, create order); the scan is not vacuous.
    expect(handlers.length).toBeGreaterThanOrEqual(4);
    for (const h of handlers) {
      expect(h.start, h.file).toMatch(
        /^const access = context\.access; if \(!access\.ok\) return denied\(access\);/,
      );
    }
  });
});
