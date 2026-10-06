import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(__dirname, "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

// SPEC §35.2: server-only helpers in src/server are loaded with `await import()`
// inside server handlers; a static import would put them in the client bundle.
describe("server code boundary", () => {
  it("nothing outside src/server imports it statically", () => {
    const offenders = sourceFiles(SRC)
      .filter((file) => !file.startsWith(path.join(SRC, "server") + path.sep))
      .filter((file) =>
        /^\s*import\s[^;]*?from\s+["'](@\/server\/|(\.\.?\/)+server\/)/m.test(
          readFileSync(file, "utf8"),
        ),
      )
      .map((file) => path.relative(SRC, file));
    expect(offenders).toEqual([]);
  });

  it("no source file reads the service role key outside the server helpers", () => {
    const offenders = sourceFiles(SRC)
      .filter((file) => readFileSync(file, "utf8").includes("SUPABASE_SERVICE_ROLE_KEY"))
      .map((file) => path.relative(SRC, file))
      .filter((file) => !file.startsWith(`server${path.sep}`) && !file.startsWith("integrations"));
    expect(offenders).toEqual([]);
  });
});
