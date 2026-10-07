import { describe, expect, it } from "vitest";

import { inIdChunks } from "./notification-data";

describe("inIdChunks()", () => {
  it("splits a long id list into .in() queries of at most 100 unique ids", async () => {
    const ids = Array.from({ length: 250 }, (_, i) => `id-${i}`);
    const chunks: string[][] = [];
    const rows = await inIdChunks([...ids, "id-0", "id-1"], async (chunk) => {
      chunks.push(chunk);
      return { data: chunk.map((id) => ({ id })), error: null };
    });
    expect(chunks.map((c) => c.length)).toEqual([100, 100, 50]);
    expect(rows.map((r) => r.id)).toEqual(ids);
  });

  it("asks nothing for no ids and throws the first error", async () => {
    let calls = 0;
    expect(
      await inIdChunks([], async () => {
        calls += 1;
        return { data: [], error: null };
      }),
    ).toEqual([]);
    expect(calls).toBe(0);
    const boom = new Error("414 URI Too Long");
    await expect(inIdChunks(["a"], async () => ({ data: null, error: boom }))).rejects.toBe(boom);
  });
});
