import { describe, expect, it } from "vitest";

import { securityHeaders } from "./security-headers";

describe("securityHeaders()", () => {
  it("only lets the app and the Lovable editor frame pages", () => {
    const csp = securityHeaders()["Content-Security-Policy"];
    expect(csp).toBe(
      "frame-ancestors 'self' https://lovable.dev https://*.lovable.dev https://gptengineer.app https://*.gptengineer.app",
    );
    expect(csp).not.toContain("localhost");
    expect(securityHeaders(true)["Content-Security-Policy"]).toContain("http://localhost:3000");
  });
});
