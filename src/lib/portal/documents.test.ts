import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import {
  checkDocument,
  classifyStorageError,
  DOCUMENT_ACCEPT,
  DOCUMENT_MAX_BYTES,
  documentDownloadName,
  documentMimeType,
  documentStoragePath,
  formatFileSize,
  storedFileName,
} from "./documents";

const MB = 1024 * 1024;

describe("documentMimeType()", () => {
  it("accepts exactly the bucket's types", () => {
    for (const type of ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic"]) {
      expect(documentMimeType({ name: "x", type }), type).toBe(type);
    }
  });

  it("refuses svg, html and other types, whatever the extension", () => {
    expect(documentMimeType({ name: "a.svg", type: "image/svg+xml" })).toBeNull();
    expect(documentMimeType({ name: "a.pdf", type: "text/html" })).toBeNull();
    expect(documentMimeType({ name: "a.heif", type: "image/heif" })).toBeNull();
  });

  it("falls back to the extension only when the browser gives no type (HEIC)", () => {
    expect(documentMimeType({ name: "IMG_0001.HEIC", type: "" })).toBe("image/heic");
    expect(documentMimeType({ name: "scan.jpeg", type: "" })).toBe("image/jpeg");
    expect(documentMimeType({ name: "notes.txt", type: "" })).toBeNull();
    expect(documentMimeType({ name: "noextension", type: "" })).toBeNull();
  });
});

describe("checkDocument()", () => {
  it("allows up to 10 MB", () => {
    expect(
      checkDocument({ name: "a.pdf", type: "application/pdf", size: DOCUMENT_MAX_BYTES }),
    ).toEqual({
      ok: true,
      mimeType: "application/pdf",
      extension: "pdf",
    });
    expect(checkDocument({ name: "a.pdf", type: "application/pdf", size: 10 * MB + 1 })).toEqual({
      ok: false,
      reason: "size",
    });
  });

  it("refuses empty files and wrong types", () => {
    expect(checkDocument({ name: "a.png", type: "image/png", size: 0 })).toEqual({
      ok: false,
      reason: "empty",
    });
    expect(checkDocument({ name: "a.svg", type: "image/svg+xml", size: 5 })).toEqual({
      ok: false,
      reason: "type",
    });
  });

  it("stores JPEGs with the .jpg extension", () => {
    expect(checkDocument({ name: "a.jpeg", type: "image/jpeg", size: 5 })).toMatchObject({
      extension: "jpg",
    });
  });
});

describe("documentStoragePath()", () => {
  const customerId = "0b6f3c1e-1d2a-4b3c-8d4e-5f6a7b8c9d0e";
  const orderId = "6f1c0d2e-8a4b-4c3d-9e5f-0a1b2c3d4e5f";
  const fileId = "A1B2C3D4-E5F6-4A7B-8C9D-0E1F2A3B4C5D";

  it("is {customer_id}/{order_id}/{uuid}.{ext}, never the user's file name", () => {
    const path = documentStoragePath(customerId, orderId, fileId, "pdf");
    expect(path).toBe(`${customerId}/${orderId}/a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d.pdf`);
    // order_documents_path_format (migration 2).
    const dbPattern = new RegExp(
      `^${customerId}/${orderId}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.(pdf|jpg|jpeg|png|webp|heic)$`,
    );
    expect(path).toMatch(dbPattern);
  });
});

describe("storedFileName()", () => {
  it("trims, keeps short names and falls back for empty ones", () => {
    expect(storedFileName("  factuur amazon.pdf ")).toBe("factuur amazon.pdf");
    expect(storedFileName("   ")).toBe("document");
  });

  it("cuts long names to 255 characters, keeping the extension", () => {
    const name = `${"a".repeat(300)}.pdf`;
    const stored = storedFileName(name);
    expect(stored).toHaveLength(255);
    expect(stored.endsWith(".pdf")).toBe(true);
  });
});

describe("documentDownloadName()", () => {
  const name = (original_filename: string, ext = "pdf") =>
    documentDownloadName({
      original_filename,
      storage_path: `c/o/0b0b0b0b-0000-4000-8000-000000000001.${ext}`,
    });

  it("always ends in the stored (database-checked) extension", () => {
    expect(name("Factuur.html")).toBe("Factuur.pdf");
    expect(name("factuur.pdf.exe")).toBe("factuur.pdf");
    expect(name("invoice.svg")).toBe("invoice.pdf");
    expect(name("run.hta")).toBe("run.pdf");
    expect(name("photo.HEIC", "heic")).toBe("photo.heic");
    expect(name("scan.jpeg", "jpg")).toBe("scan.jpg");
    expect(name("geen-extensie")).toBe("geen-extensie.pdf");
  });

  it("keeps plain ASCII only, so storage-js does not mangle it", () => {
    expect(name("factuur-coördinaat.pdf")).toBe("factuur-coordinaat.pdf");
    expect(name("Factuur #3.pdf")).toBe("Factuur 3.pdf");
    expect(name("a&b.pdf")).toBe("a b.pdf");
    expect(name("100%.pdf")).toBe("100.pdf");
    expect(name("../../etc/passwd")).toBe("etc passwd.pdf");
    expect(name(".verborgen.pdf")).toBe("verborgen.pdf");
    expect(name("报关单.pdf")).toBe("document.pdf");
  });

  it("keeps dots that are not an extension, and caps the length", () => {
    expect(name("Factuur 2026.10.05.pdf")).toBe("Factuur 2026.10.05.pdf");
    const long = name(`${"a".repeat(300)}.pdf`);
    expect(long).toBe(`${"a".repeat(100)}.pdf`);
  });
});

describe("classifyStorageError()", () => {
  it("maps Storage API status codes", () => {
    expect(
      classifyStorageError({ message: "Payload too large", status: 413, statusCode: "413" }),
    ).toBe("size");
    expect(
      classifyStorageError({ message: "mime type image/gif is not supported", status: 415 }),
    ).toBe("type");
    expect(
      classifyStorageError({
        message: "new row violates row-level security policy",
        status: 400,
        statusCode: "403",
      }),
    ).toBe("forbidden");
    expect(classifyStorageError({ message: "Internal", status: 500 })).toBe("upload");
  });

  it("leaves network failures to errors.ts", () => {
    expect(classifyStorageError({ message: "Failed to fetch" })).toBeNull();
  });
});

describe("misc", () => {
  it("offers extensions in the file picker for browsers that do not type HEIC", () => {
    expect(DOCUMENT_ACCEPT).toContain(".heic");
    expect(DOCUMENT_ACCEPT).toContain("application/pdf");
    expect(DOCUMENT_ACCEPT).not.toContain("svg");
  });

  it("formats sizes in Dutch", () => {
    expect(formatFileSize(2.45 * MB)).toBe("2,5 MB");
    expect(formatFileSize(312 * 1024)).toBe("312 kB");
    expect(formatFileSize(10)).toBe("1 kB");
  });
});
