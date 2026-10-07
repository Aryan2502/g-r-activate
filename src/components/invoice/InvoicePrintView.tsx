import { useEffect, useRef, useState, type ReactNode } from "react";
import { Loader2, Printer } from "lucide-react";
import { toast } from "sonner";

import { InvoicePreview } from "@/components/invoice/InvoiceDocument";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n";
import { printTitle, type InvoiceRenderModel } from "@/lib/invoice/model";
import { waitForInvoiceAssets } from "@/lib/invoice/print";

/**
 * The print routes' page (SPEC §35.11 "PDF"): ONLY the invoice document, at
 * true paper size, outside the app shell. Once the fonts and the logo have
 * loaded it sets document.title to '{invoice_number} - G&R Solutions' (the
 * browser's suggested PDF file name) and opens the browser's own print
 * dialog ("Opslaan als PDF"); no Puppeteer, html2canvas or jsPDF. The small
 * toolbar is for the screen only and never prints.
 */
export function InvoicePrintView({
  model,
  back,
}: {
  model: InvoiceRenderModel;
  /** "Terug naar de factuur" (screen only). */
  back: ReactNode;
}) {
  const t = useT();
  const sheet = useRef<HTMLDivElement>(null);
  const started = useRef(false);
  const [ready, setReady] = useState(false);
  const title = printTitle(model);

  useEffect(() => {
    document.title = title;
  }, [title]);

  // Print once, after the assets are in (StrictMode mounts twice: the ref
  // keeps it to one dialog, and a page left in the meantime never prints).
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      await waitForInvoiceAssets(sheet.current ?? document);
      if (!sheet.current?.isConnected) return;
      document.title = title;
      setReady(true);
      // A toast from the page before (e.g. "Gekopieerd") must not print;
      // styles.css also hides the toaster on paper.
      toast.dismiss();
      window.print();
    })();
  }, [title]);

  return (
    <div className="min-h-screen bg-muted/60 print:min-h-0 print:bg-white">
      <div className="mx-auto flex max-w-[52rem] flex-wrap items-center justify-between gap-3 px-4 py-4 print:hidden">
        {back}
        <div className="flex flex-wrap items-center gap-3">
          {!ready ? (
            <span className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              {t("invoicePrint.preparing")}
            </span>
          ) : null}
          <Button onClick={() => window.print()} disabled={!ready}>
            <Printer aria-hidden />
            {t("invoicePrint.print")}
          </Button>
        </div>
        <p className="w-full text-xs text-muted-foreground">{t("invoicePrint.hint")}</p>
      </div>
      {/* On screen: true size, shrunk to fit a phone; on paper: unscaled. */}
      <main className="mx-auto max-w-[52rem] px-4 pb-10 print:max-w-none print:p-0">
        <div ref={sheet}>
          <InvoicePreview model={model} label={t("invoicePrint.title")} />
        </div>
      </main>
    </div>
  );
}
