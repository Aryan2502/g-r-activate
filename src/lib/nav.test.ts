import { describe, expect, it } from "vitest";

import { activeNavPath } from "./nav";

const portalNav = [
  { to: "/portal", exact: true },
  { to: "/portal/orders" },
  { to: "/portal/orders/nieuw" },
  { to: "/portal/profiel" },
];

describe("activeNavPath()", () => {
  it("matches exact items only on their own path", () => {
    expect(activeNavPath(portalNav, "/portal")).toBe("/portal");
    expect(activeNavPath(portalNav, "/portal/")).toBe("/portal");
    expect(activeNavPath([{ to: "/portal", exact: true }], "/portal/profiel")).toBeNull();
  });

  it("keeps a section active on its sub-pages", () => {
    expect(activeNavPath(portalNav, "/portal/orders")).toBe("/portal/orders");
    expect(activeNavPath(portalNav, "/portal/orders/6f1c0d2e-8a4b-4c3d-9e5f-0a1b2c3d4e5f")).toBe(
      "/portal/orders",
    );
  });

  it("prefers the most specific item", () => {
    expect(activeNavPath(portalNav, "/portal/orders/nieuw")).toBe("/portal/orders/nieuw");
  });

  it("does not match on a shared prefix that is not a path segment", () => {
    expect(activeNavPath(portalNav, "/portal/ordersx")).toBeNull();
  });
});
