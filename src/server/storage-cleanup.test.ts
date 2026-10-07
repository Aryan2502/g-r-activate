import { describe, expect, it, vi } from "vitest";

import type { StorageAdminClient } from "./admin-client";
import { cleanupOrphanUploads } from "./storage-cleanup";

/** The service-role client as the clean-up uses it: job_runs, the RPC and Storage. */
function admin(opts: {
  orphans?: { name: string; created_at: string }[];
  rpcError?: { code: string; message: string };
  removeFails?: boolean;
}) {
  const runs: Record<string, unknown>[] = [];
  const removed: string[][] = [];
  const client = {
    from: (table: string) => {
      expect(table).toBe("job_runs");
      return {
        insert: (row: Record<string, unknown>) => {
          runs.push({ ...row });
          return {
            select: () => ({ single: async () => ({ data: { id: "run-1" }, error: null }) }),
          };
        },
        update: (patch: Record<string, unknown>) => ({
          eq: async () => {
            Object.assign(runs[0]!, patch);
            return { error: null };
          },
        }),
      };
    },
    rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
      expect(fn).toBe("orphan_order_document_objects");
      expect(args).toEqual({ _min_age_hours: 24, _limit: 500 });
      return opts.rpcError
        ? { data: null, error: opts.rpcError }
        : { data: opts.orphans ?? [], error: null };
    }),
    storage: {
      from: (bucket: string) => {
        expect(bucket).toBe("order-documents");
        return {
          remove: async (paths: string[]) => {
            removed.push(paths);
            return opts.removeFails
              ? { data: null, error: { message: "storage down" } }
              : { data: paths.map((name) => ({ name })), error: null };
          },
        };
      },
    },
  };
  return { client: client as unknown as StorageAdminClient, runs, removed };
}

const now = () => new Date("2026-10-07T12:00:00Z");

describe("cleanupOrphanUploads()", () => {
  it("removes what the RPC lists through the Storage API, in chunks of 100, and logs the run", async () => {
    const orphans = Array.from({ length: 150 }, (_, i) => ({
      name: `c/o/${i}.pdf`,
      created_at: "2026-10-05T12:00:00Z",
    }));
    const { client, runs, removed } = admin({ orphans });
    const result = await cleanupOrphanUploads(client, { trigger: "cron", now });
    expect(result).toEqual({
      status: "succeeded",
      stats: { found: 150, removed: 150, failed: 0 },
      error: null,
    });
    expect(removed.map((r) => r.length)).toEqual([100, 50]);
    expect(runs[0]).toMatchObject({
      job: "storage_cleanup",
      trigger: "cron",
      status: "succeeded",
      finished_at: "2026-10-07T12:00:00.000Z",
      stats: { found: 150, removed: 150, failed: 0 },
    });
  });

  it("nothing to remove: a quiet, successful run", async () => {
    const { client, removed } = admin({ orphans: [] });
    expect(await cleanupOrphanUploads(client, { trigger: "cron", now })).toMatchObject({
      status: "succeeded",
      stats: { found: 0, removed: 0, failed: 0 },
    });
    expect(removed).toEqual([]);
  });

  it("a Storage failure is recorded, never thrown", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { client, runs } = admin({
      orphans: [{ name: "c/o/1.pdf", created_at: "2026-10-05T12:00:00Z" }],
      removeFails: true,
    });
    expect(await cleanupOrphanUploads(client, { trigger: "cron", now })).toMatchObject({
      status: "failed",
      stats: { found: 1, removed: 0, failed: 1 },
    });
    expect(runs[0]).toMatchObject({ status: "failed" });
    error.mockRestore();
  });

  it("before the P8 migration (no RPC yet) it says so instead of deleting anything", async () => {
    const { client, removed } = admin({ rpcError: { code: "PGRST202", message: "not found" } });
    const result = await cleanupOrphanUploads(client, { trigger: "cron", now });
    expect(result.status).toBe("failed");
    expect(result.error).toMatch(/20261008090000_p8_reminders\.sql/);
    expect(removed).toEqual([]);
  });
});
