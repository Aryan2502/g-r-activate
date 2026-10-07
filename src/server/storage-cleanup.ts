import "@tanstack/react-start/server-only";

import { z } from "zod";

import type { StorageAdminClient } from "@/server/admin-client";

/**
 * Orphaned uploads (PROGRESS carry-over, SPEC §35.7): the browser uploads a
 * document straight to Storage and records it in order_documents afterwards;
 * when that second step never happens (tab closed, network gone) the file
 * stays behind. The daily cron run removes files in 'order-documents' that
 * are older than 24 hours and have no order_documents row: the list comes
 * from public.orphan_order_document_objects() (service role only, never
 * younger than 24 h), the files go through the Storage API (never SQL).
 * Every run writes a job_runs row (job 'storage_cleanup').
 */

export const STORAGE_CLEANUP_JOB = "storage_cleanup";
export const DOCUMENTS_BUCKET = "order-documents";
const REMOVE_CHUNK = 100;

export interface CleanupStats {
  found: number;
  removed: number;
  failed: number;
}

export interface CleanupResult {
  status: "succeeded" | "failed";
  stats: CleanupStats;
  error: string | null;
}

/**
 * Not in the generated types until migration 20261008090000_p8_reminders.sql
 * is applied and types.ts regenerated; this narrow signature stands in, and
 * the answer is checked with zod.
 */
type OrphanRpc = (
  fn: "orphan_order_document_objects",
  args: { _min_age_hours: number; _limit: number },
) => PromiseLike<{ data: unknown; error: { code?: string; message: string } | null }>;

const orphanRows = z.array(z.object({ name: z.string().min(1), created_at: z.string() }));

const MISSING_FUNCTION = new Set(["PGRST202", "42883"]);

export async function cleanupOrphanUploads(
  admin: StorageAdminClient,
  options: { trigger: "cron" | "manual"; now?: () => Date },
): Promise<CleanupResult> {
  const now = options.now ?? (() => new Date());
  const { data: run, error: runError } = await admin
    .from("job_runs")
    .insert({ job: STORAGE_CLEANUP_JOB, trigger: options.trigger, status: "running" })
    .select("id")
    .single();
  if (runError) throw runError;

  const stats: CleanupStats = { found: 0, removed: 0, failed: 0 };
  let error: string | null = null;
  try {
    const rpc = admin.rpc as unknown as OrphanRpc;
    const found = await rpc.call(admin, "orphan_order_document_objects", {
      _min_age_hours: 24,
      _limit: 500,
    });
    if (found.error) {
      if (MISSING_FUNCTION.has(found.error.code ?? "")) {
        error = "Migratie 20261008090000_p8_reminders.sql is nog niet toegepast";
      } else {
        throw found.error;
      }
    } else {
      const names = orphanRows.parse(found.data ?? []).map((r) => r.name);
      stats.found = names.length;
      for (let i = 0; i < names.length; i += REMOVE_CHUNK) {
        const chunk = names.slice(i, i + REMOVE_CHUNK);
        const { data, error: removeError } = await admin.storage
          .from(DOCUMENTS_BUCKET)
          .remove(chunk);
        if (removeError) {
          console.error("[storage-cleanup] remove failed", removeError);
          stats.failed += chunk.length;
        } else {
          stats.removed += data?.length ?? 0;
          stats.failed += chunk.length - (data?.length ?? 0);
        }
      }
      if (stats.failed > 0) error = `${stats.failed} bestand(en) konden niet worden verwijderd`;
    }
  } catch (err) {
    console.error("[storage-cleanup] failed", err);
    error = (err instanceof Error ? err.message : String(err)).slice(0, 5000);
  }

  const status = error ? "failed" : "succeeded";
  const { error: finishError } = await admin
    .from("job_runs")
    .update({ status, finished_at: now().toISOString(), stats: { ...stats }, error })
    .eq("id", run.id);
  if (finishError) console.error("[storage-cleanup] could not record the run", finishError);
  return { status, stats, error };
}
