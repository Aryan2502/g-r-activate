import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const DIR = path.resolve(__dirname, "../../supabase/templates");

// SPEC §35.6: our own token_hash links, verified on /auth/confirm only after a click.
describe("Supabase auth email templates", () => {
  it.each([
    ["confirm_signup.html", "email"],
    ["recovery.html", "recovery"],
    ["magic_link.html", "magiclink"],
  ])("%s links to /auth/confirm with type=%s", (file, type) => {
    const html = readFileSync(path.join(DIR, file), "utf8");
    const links = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link).toBe(`{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&amp;type=${type}`);
    }
    expect(html).toContain('src="{{ .SiteURL }}/brand/gr-logo-banner.jpg"');
    expect(html).toContain('lang="nl"');
    expect(html).not.toContain("{{ .ConfirmationURL }}");
    expect(html).not.toMatch(/<link\b|<style\b|<script\b/i);
  });
});
