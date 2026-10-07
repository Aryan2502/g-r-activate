import { QueryClient } from "@tanstack/react-query";
import { createRouter, rootRouteId } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";

import { routeTree } from "@/routeTree.gen";

// Match routes without running loaders or rendering: loaders may need a server or
// network the test run lacks, and jsdom never loads the stylesheets React waits on.
describe("App routing", () => {
  const router = createRouter({ routeTree, context: { queryClient: new QueryClient() } });
  const leaf = (path: string) => router.matchRoutes(path).at(-1)?.routeId;

  it("matches a page for / instead of falling back to not found", () => {
    expect(leaf("/")).not.toBe(rootRouteId);
  });

  it.each([
    ["/login", "/_auth/login"],
    ["/registreren", "/_auth/registreren"],
    ["/wachtwoord-vergeten", "/_auth/wachtwoord-vergeten"],
    ["/auth/confirm", "/_auth/auth/confirm"],
    ["/auth/set-password", "/_auth/auth/set-password"],
    ["/portal", "/portal/"],
    ["/portal/profiel", "/portal/profiel"],
    ["/portal/orders", "/portal/orders/"],
    // The static segment wins over $id, so "nieuw" is never read as an order id.
    ["/portal/orders/nieuw", "/portal/orders/nieuw"],
    ["/portal/orders/6f1c0d2e-8a4b-4c3d-9e5f-0a1b2c3d4e5f", "/portal/orders/$id"],
    ["/admin", "/admin/"],
  ])("serves %s", (path, routeId) => {
    expect(leaf(path)).toBe(routeId);
  });

  it("renders the signed-in areas in the browser only (SPEC §35.2)", () => {
    for (const id of [
      "/portal",
      "/admin",
      "/_auth/auth/confirm",
      "/_auth/auth/set-password",
    ] as const) {
      expect(router.routesById[id].options.ssr, id).toBe(false);
    }
  });
});
