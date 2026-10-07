import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { fake: true } }));

import { loadAdminClient } from "./admin-client";
import { MissingEnvError } from "./env";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("loadAdminClient()", () => {
  it("refuses with a named error while the service-role key is not configured", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    const error = await loadAdminClient().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MissingEnvError);
    expect((error as MissingEnvError).variable).toBe("SUPABASE_SERVICE_ROLE_KEY");
  });

  it("hands out the server-only client once the key exists", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "sb_secret_test");
    expect(await loadAdminClient()).toEqual({ fake: true });
  });
});
