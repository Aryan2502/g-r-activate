import { describe, expect, it } from "vitest";

import { DOCUMENT_MAX_BYTES } from "./documents";
import {
  MAX_ORDER_FILES,
  addToQueue,
  defaultDocumentKind,
  uploadSummary,
  type QueuedDocument,
} from "./document-queue";

const file = (name: string, type: string, size = 1000, lastModified = 1) =>
  ({ name, type, size, lastModified }) as File;

describe("addToQueue()", () => {
  it("queues allowed files with the chosen kind and reports refused ones", () => {
    const { queue, rejected } = addToQueue(
      [],
      [
        file("factuur.pdf", "application/pdf"),
        file("foto.HEIC", ""),
        file("logo.svg", "image/svg+xml"),
        file("groot.pdf", "application/pdf", DOCUMENT_MAX_BYTES + 1),
        file("leeg.png", "image/png", 0),
      ],
      "purchase_invoice",
    );
    expect(queue.map((d) => [d.file.name, d.kind])).toEqual([
      ["factuur.pdf", "purchase_invoice"],
      ["foto.HEIC", "purchase_invoice"],
    ]);
    expect(rejected).toEqual([
      { name: "logo.svg", reason: "type" },
      { name: "groot.pdf", reason: "size" },
      { name: "leeg.png", reason: "empty" },
    ]);
  });

  it("skips a file that is already queued", () => {
    const first = addToQueue([], [file("a.pdf", "application/pdf")], "other");
    const again = addToQueue(first.queue, [file("a.pdf", "application/pdf")], "other");
    expect(again.queue).toHaveLength(1);
    expect(again.rejected).toEqual([]);
  });

  it("stops at the maximum number of files", () => {
    const full: QueuedDocument[] = Array.from({ length: MAX_ORDER_FILES }, (_, i) => ({
      key: `k${i}`,
      file: file(`f${i}.pdf`, "application/pdf", 10, i),
      kind: "other",
    }));
    const { queue, rejected } = addToQueue(full, [file("extra.pdf", "application/pdf")], "other");
    expect(queue).toHaveLength(MAX_ORDER_FILES);
    expect(rejected).toEqual([{ name: "extra.pdf", reason: "tooMany" }]);
  });
});

describe("defaultDocumentKind()", () => {
  it("suggests a commercial invoice for B2B (customs) and a purchase invoice otherwise", () => {
    expect(defaultDocumentKind("b2b")).toBe("commercial_invoice");
    expect(defaultDocumentKind("personal")).toBe("purchase_invoice");
  });
});

describe("uploadSummary()", () => {
  it("counts done and failed uploads", () => {
    expect(
      uploadSummary([
        { status: "done" },
        { status: "failed", error: "x" },
        { status: "uploading" },
        { status: "waiting" },
      ]),
    ).toEqual({ total: 4, done: 1, failed: 1, busy: true, percent: 25 });
    expect(uploadSummary([{ status: "done" }, { status: "done" }])).toMatchObject({
      busy: false,
      percent: 100,
    });
  });
});
