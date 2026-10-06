import { describe, expect, it } from "vitest";

import { homePathForRole, postLoginPath, safeRedirect } from "./redirect";

describe("safeRedirect()", () => {
  it("accepts same-site paths", () => {
    expect(safeRedirect("/portal")).toBe("/portal");
    expect(safeRedirect("/portal/profiel?tab=1#x")).toBe("/portal/profiel?tab=1#x");
    expect(safeRedirect("/")).toBe("/");
  });

  it("refuses anything that could leave the site", () => {
    for (const value of [
      "//evil.example",
      "///evil.example",
      "/\\evil.example",
      "\\\\evil.example",
      "https://evil.example",
      "javascript:alert(1)",
      "portal",
      "",
      " /portal",
      "/\tportal",
      "/portal\n",
    ]) {
      expect(safeRedirect(value), JSON.stringify(value)).toBeNull();
    }
    expect(safeRedirect(undefined)).toBeNull();
    expect(safeRedirect(42)).toBeNull();
    expect(safeRedirect(`/${"a".repeat(3000)}`)).toBeNull();
  });
});

describe("postLoginPath()", () => {
  it("sends staff to /admin and customers to /portal by default", () => {
    expect(homePathForRole("admin")).toBe("/admin");
    expect(homePathForRole("staff")).toBe("/admin");
    expect(homePathForRole("customer")).toBe("/portal");
    expect(postLoginPath("staff", undefined)).toBe("/admin");
    expect(postLoginPath("customer", null)).toBe("/portal");
  });

  it("honours a safe redirect inside the user's own area", () => {
    expect(postLoginPath("customer", "/portal/profiel")).toBe("/portal/profiel");
    expect(postLoginPath("admin", "/admin?x=1")).toBe("/admin?x=1");
    expect(postLoginPath("customer", "/voorwaarden")).toBe("/voorwaarden");
  });

  it("ignores redirects into the other area, auth pages or other sites", () => {
    expect(postLoginPath("customer", "/admin")).toBe("/portal");
    expect(postLoginPath("customer", "/admin/klanten")).toBe("/portal");
    expect(postLoginPath("staff", "/portal/profiel")).toBe("/admin");
    expect(postLoginPath("customer", "/login?redirect=/portal")).toBe("/portal");
    expect(postLoginPath("customer", "/auth/set-password")).toBe("/portal");
    expect(postLoginPath("customer", "//evil.example")).toBe("/portal");
    expect(postLoginPath("customer", "/portaal")).toBe("/portaal");
  });
});
