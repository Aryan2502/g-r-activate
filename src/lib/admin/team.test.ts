import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

const {
  assertRecoveryForMember,
  assertTeamLoginChange,
  changeTeamRole,
  effectiveRole,
  inviteStaffSchema,
  loadTeam,
  memberName,
  sortTeam,
} = await import("./team");
type TeamMember = import("./team").TeamMember;

const member = (extra: Partial<TeamMember>): TeamMember => ({
  userId: "u1",
  displayName: "Maria",
  email: "maria@example.com",
  roles: ["staff"],
  blocked: false,
  lastSignInAt: null,
  memberSince: null,
  ...extra,
});

/** A client whose rpc/from answers are scripted. */
function fakeClient(answers: {
  rpc?: (name: string, args?: Record<string, unknown>) => { data: unknown; error: unknown };
  from?: Record<string, unknown[]>;
}) {
  const calls: { name: string; args?: Record<string, unknown> }[] = [];
  const query = (rows: unknown[]) => {
    const q: Record<string, unknown> = {};
    for (const m of ["select", "order", "in", "eq", "is"]) q[m] = () => q;
    q["then"] = (ok: (v: unknown) => unknown) =>
      Promise.resolve({ data: rows, error: null }).then(ok);
    return q;
  };
  return {
    calls,
    client: {
      rpc: (name: string, args?: Record<string, unknown>) => {
        calls.push({ name, ...(args ? { args } : {}) });
        return Promise.resolve(answers.rpc?.(name, args) ?? { data: null, error: null });
      },
      from: (table: string) => query(answers.from?.[table] ?? []),
    } as unknown as Parameters<typeof loadTeam>[0],
  };
}

describe("team helpers", () => {
  it("the highest role is the one shown; names fall back to the e-mail", () => {
    expect(effectiveRole(["admin", "staff"])).toBe("admin");
    expect(effectiveRole(["staff"])).toBe("staff");
    expect(memberName({ displayName: null, email: "kim@example.com" })).toBe("kim@example.com");
    expect(memberName({ displayName: null, email: null })).toBe("Naam onbekend");
    expect(
      sortTeam([
        member({ userId: "b", displayName: "Zoë" }),
        member({ userId: "a", displayName: "ánne" }),
      ]).map((m) => m.userId),
    ).toEqual(["a", "b"]);
  });

  it("deactivating: team members only, never yourself, not twice; unknown state is not 'twice'", () => {
    const team = { complete: true, members: [member({ userId: "me" }), member({ userId: "u1" })] };
    expect(assertTeamLoginChange(team, "me", { userId: "u1", blocked: true }).userId).toBe("u1");
    expect(() => assertTeamLoginChange(team, "me", { userId: "me", blocked: true })).toThrow(
      "U kunt uw eigen login niet deactiveren.",
    );
    expect(() => assertTeamLoginChange(team, "me", { userId: "x", blocked: true })).toThrow(
      "Deze login hoort niet bij het team.",
    );
    expect(() => assertTeamLoginChange(team, "me", { userId: "u1", blocked: false })).toThrow(
      "Deze login is niet gedeactiveerd.",
    );
    const fallback = { complete: false, members: [member({ userId: "u1", blocked: null })] };
    expect(assertTeamLoginChange(fallback, "me", { userId: "u1", blocked: false }).userId).toBe(
      "u1",
    );
    expect(() =>
      assertRecoveryForMember({ complete: true, members: [member({ blocked: true })] }, "u1"),
    ).toThrow(/gedeactiveerd/);
  });

  it("before the migration: the list comes from user_roles and profiles, marked incomplete", async () => {
    const { client } = fakeClient({
      rpc: () => ({ data: null, error: { code: "PGRST202", message: "not found" } }),
      from: {
        user_roles: [
          { user_id: "u2", role: "staff", created_at: "2026-10-02T00:00:00Z" },
          { user_id: "u1", role: "admin", created_at: "2026-10-01T00:00:00Z" },
          { user_id: "u1", role: "staff", created_at: "2026-10-03T00:00:00Z" },
        ],
        profiles: [
          { id: "u1", display_name: "Ada" },
          { id: "u2", display_name: null },
        ],
      },
    });
    const team = await loadTeam(client);
    expect(team.complete).toBe(false);
    expect(team.members).toEqual([
      {
        userId: "u1",
        displayName: "Ada",
        email: null,
        roles: ["admin", "staff"],
        blocked: null,
        lastSignInAt: null,
        memberSince: "2026-10-01T00:00:00Z",
      },
      {
        userId: "u2",
        displayName: null,
        email: null,
        roles: ["staff"],
        blocked: null,
        lastSignInAt: null,
        memberSince: "2026-10-02T00:00:00Z",
      },
    ]);
  });

  it("another error of team_members() is not hidden behind the fallback", async () => {
    const { client } = fakeClient({
      rpc: () => ({ data: null, error: { code: "42501", message: "Geen toegang" } }),
    });
    await expect(loadTeam(client)).rejects.toMatchObject({ code: "42501" });
  });

  it("admin → staff: staff role first, then admin removed; refused → the added staff role is taken back", async () => {
    const ok = fakeClient({});
    await changeTeamRole(ok.client, { userId: "u1", roles: ["admin"] }, "staff");
    expect(ok.calls.map((c) => [c.args?.["_role"], c.args?.["_grant"]])).toEqual([
      ["staff", true],
      ["admin", false],
    ]);

    const refused = fakeClient({
      rpc: (_name, args) =>
        args?.["_role"] === "admin" && args["_grant"] === false
          ? {
              data: null,
              error: { code: "55000", message: "De laatste beheerder kan niet worden verwijderd" },
            }
          : { data: null, error: null },
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      changeTeamRole(refused.client, { userId: "u1", roles: ["admin"] }, "staff"),
    ).rejects.toMatchObject({ code: "55000" });
    expect(refused.calls.map((c) => [c.args?.["_role"], c.args?.["_grant"]])).toEqual([
      ["staff", true],
      ["admin", false],
      ["staff", false],
    ]);

    const promote = fakeClient({});
    await changeTeamRole(promote.client, { userId: "u1", roles: ["staff"] }, "admin");
    expect(promote.calls.map((c) => [c.args?.["_role"], c.args?.["_grant"]])).toEqual([
      ["admin", true],
    ]);
  });

  it("the invite form normalises the address and the phone number", () => {
    expect(
      inviteStaffSchema.parse({
        email: " Kim@Example.COM ",
        role: "admin",
        fullName: "",
        phone: "8123456",
      }),
    ).toEqual({ email: "kim@example.com", role: "admin", fullName: null, phone: "+5978123456" });
    expect(
      inviteStaffSchema.safeParse({ email: "", role: "staff", fullName: "", phone: "" }).success,
    ).toBe(false);
  });
});
