/**
 * Browser helpers for the print routes (SPEC §35.11 "PDF"): the browser's
 * own print dialog ("Opslaan als PDF"); no Puppeteer, html2canvas or jsPDF.
 */

/**
 * Resolves once the fonts and every image inside `root` (the logo) are ready,
 * so window.print() never captures fallback fonts or an empty logo band. A
 * broken image does not block printing.
 */
export async function waitForInvoiceAssets(root: ParentNode = document): Promise<void> {
  if (typeof document !== "undefined" && "fonts" in document) {
    await document.fonts.ready;
  }
  const images = Array.from(root.querySelectorAll("img"));
  await Promise.all(
    images.map(async (img) => {
      if (img.complete && img.naturalWidth > 0) return;
      try {
        await img.decode();
      } catch {
        // A logo that failed to load must not block printing.
      }
    }),
  );
}
