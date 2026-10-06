import { QueryClient } from "@tanstack/react-query";
import { isRedirect, type ParsedLocation } from "@tanstack/react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: null as { user: { id: string; email: string } } | null,
  roles: { is_admin: false, is_staff: false } as Record<string, boolean>,
  rpcCalls: [] as string[],
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: () => Promise.resolve({ data: { session: mocks.session }, error: null }),
    },
    rpc: (fn: string) => {
      mocks.rpcCalls.push(fn);
      return Promise.resolve({ data: mocks.roles[fn] ?? false, error: null });
    },
  },
}));

import { requireArea } from "./guards";

function location(href: string): ParsedLocation {
  return { href, pathname: href.split("?")[0] } as ParsedLocation;
}

async function redirectHref(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (isRedirect(error)) return error.options.href ?? "";
    throw error;
  }
  throw new Error("expected a redirect");
}

describe("requireArea()", () => {
  beforeEach(() => {
    mocks.session = { user: { id: "u1", email: "maria@example.com" } };
    mocks.roles = { is_admin: false, is_staff: false };
    mocks.rpcCalls = [];
  });

  it("sends visitors without a session to /login with a redirect back", async () => {
    mocks.session = null;
    const href = await redirectHref(
      requireArea("portal", {
        queryClient: new QueryClient(),
        location: location("/portal/profiel?x=1"),
      }),
    );
    const url = new URL(href, "https://gr.example");
    expect(url.pathname).toBe("/login");
    expect(url.searchParams.get("redirect")).toBe("/portal/profiel?x=1");
    expect(mocks.rpcCalls).toEqual([]);
  });

  it("lets customers into /portal and sends them away from /admin", async () => {
    await expect(
      requireArea("portal", { queryClient: new QueryClient(), location: location("/portal") }),
    ).resolves.toEqual({ auth: { userId: "u1", email: "maria@example.com", role: "customer" } });
    expect(
      await redirectHref(
        requireArea("admin", { queryClient: new QueryClient(), location: location("/admin") }),
      ),
    ).toBe("/portal");
  });

  it("lets staff into /admin and sends them away from /portal", async () => {
    mocks.roles = { is_admin: false, is_staff: true };
    await expect(
      requireArea("admin", { queryClient: new QueryClient(), location: location("/admin") }),
    ).resolves.toMatchObject({ auth: { role: "staff" } });
    expect(
      await redirectHref(
        requireArea("portal", { queryClient: new QueryClient(), location: location("/portal") }),
      ),
    ).toBe("/admin");
  });

  it("caches the role per user in the query client", async () => {
    mocks.roles = { is_admin: true, is_staff: true };
    const queryClient = new QueryClient();
    await requireArea("admin", { queryClient, location: location("/admin") });
    await requireArea("admin", { queryClient, location: location("/admin") });
    expect(mocks.rpcCalls).toHaveLength(2);
    expect(queryClient.getQueryData(["auth", "u1", "role"])).toBe("admin");
  });
});
