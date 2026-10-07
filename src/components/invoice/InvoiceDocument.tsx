import { useLayoutEffect, useRef, useState } from "react";

import { brandAssets } from "@/lib/brand";
import { formatDate } from "@/lib/format";
import { INVOICE_LABELS } from "@/lib/invoice/labels";
import {
  PAPER_PX,
  documentDensity,
  itemPaddingRows,
  itemRows,
  paymentColumns,
  paymentInstruction,
  referencesText,
  registrationLine,
  statusMark,
  summaryRows,
  type InvoiceRenderModel,
} from "@/lib/invoice/model";

/**
 * The G&R invoice (SPEC §35.11): ONE renderer for the builder's live
 * preview, the admin and customer invoice pages and the print routes. It
 * prints exactly what the model says (see lib/invoice/model.ts:
 * fromDraftForm / fromIssuedInvoice) in the Word template's layout, with
 * its own hex colours (invoice-document.css), at true paper size (Letter
 * 816×1056 px or A4 794×1123 px from the paper_size setting/snapshot).
 *
 * On screen the sheet is one tall page; on paper the @page rule below sets
 * the size and margins, the items header repeats on every page, the footer
 * prints on every page and the summary, payment block and terms stay
 * together. Wrap it in <InvoicePreview> to show it scaled to a column.
 */
export function InvoiceDocument({
  model,
  className,
}: {
  model: InvoiceRenderModel;
  className?: string;
}) {
  const { issuer, billTo, meta } = model;
  const items = itemRows(model);
  const summary = summaryRows(model);
  const padding = itemPaddingRows(items.length, summary.length);
  const bank = paymentColumns(model);
  const registration = registrationLine(issuer);
  const mark = statusMark(model.status);
  const references = referencesText(meta.references);
  const business = billTo.accountType === "business" && billTo.companyName;
  const pageSize = issuer.paperSize === "A4" ? "A4" : "letter";

  return (
    <div className={className ? `gr-inv ${className}` : "gr-inv"}>
      {/* Applies only when printing (the print routes show this document alone). */}
      <style>{`@page { size: ${pageSize}; margin: 0.45in 0.55in; }`}</style>
      <article
        className="gr-inv-sheet"
        data-paper={issuer.paperSize}
        data-status={model.status.status}
        data-density={documentDensity(items.length, summary.length)}
        aria-label={meta.invoiceNumber ?? INVOICE_LABELS.draftNumber}
      >
        {mark && mark.kind !== "paid" ? (
          <div className="gr-inv-watermark" data-kind={mark.kind} aria-hidden="true">
            {mark.text}
          </div>
        ) : null}

        <table className="gr-inv-frame" role="presentation">
          <tbody>
            <tr>
              <td>
                <div className="gr-inv-content">
                  <div className="gr-inv-logo">
                    <img
                      src={brandAssets.banner.src}
                      width={brandAssets.banner.width}
                      height={brandAssets.banner.height}
                      alt={issuer.companyName}
                      data-invoice-logo=""
                      decoding="sync"
                    />
                  </div>

                  <div className="gr-inv-masthead">
                    <p className="gr-inv-title">{issuer.invoiceTitle}</p>

                    {/* On a paid invoice the stamp sits in the contact block's right
                        gutter (reserved in the CSS), so it never covers a line. */}
                    <div className="gr-inv-contact">
                      {issuer.email ? (
                        <p>
                          {INVOICE_LABELS.email} {issuer.email}
                        </p>
                      ) : null}
                      {issuer.phone ? (
                        <p>
                          {INVOICE_LABELS.phone} {issuer.phone}
                        </p>
                      ) : null}
                      {issuer.address ? (
                        <p>
                          {INVOICE_LABELS.address} {issuer.address}
                        </p>
                      ) : null}
                      {registration ? <p>{registration}</p> : null}
                      {mark?.kind === "paid" ? (
                        <p className="gr-inv-stamp" data-kind="paid">
                          <span className="gr-inv-stamp-word">{INVOICE_LABELS.paidWord}</span>{" "}
                          {mark.date ? (
                            <span className="gr-inv-stamp-date">{mark.date}</span>
                          ) : null}
                        </p>
                      ) : null}
                    </div>
                  </div>

                  <table className="gr-inv-table gr-inv-info">
                    <colgroup>
                      <col style={{ width: "16%" }} />
                      <col style={{ width: "34%" }} />
                      <col style={{ width: "16%" }} />
                      <col style={{ width: "34%" }} />
                    </colgroup>
                    <tbody>
                      <tr>
                        <th scope="row">{INVOICE_LABELS.customerName}</th>
                        <td>
                          {business ? (
                            <>
                              {billTo.companyName}
                              <span className="gr-inv-name-company">{billTo.fullName}</span>
                            </>
                          ) : (
                            billTo.fullName
                          )}
                        </td>
                        <th scope="row">{INVOICE_LABELS.customerCode}</th>
                        <td className="gr-inv-value-cell">{billTo.customerCode}</td>
                      </tr>
                      <tr>
                        <th scope="row">{INVOICE_LABELS.date}</th>
                        <td className="gr-inv-value-cell">
                          {meta.invoiceDate ? formatDate(meta.invoiceDate) : ""}
                        </td>
                        <th scope="row">{INVOICE_LABELS.invoiceNumber}</th>
                        <td className="gr-inv-value-cell">
                          {meta.invoiceNumber ?? INVOICE_LABELS.draftNumber}
                        </td>
                      </tr>
                      <tr>
                        <th scope="row">{INVOICE_LABELS.dueDate}</th>
                        <td className="gr-inv-value-cell">
                          {meta.dueDate ? formatDate(meta.dueDate) : ""}
                        </td>
                        <th scope="row">{INVOICE_LABELS.reference}</th>
                        <td
                          className={
                            meta.references.length > 2
                              ? "gr-inv-value-cell gr-inv-refs"
                              : "gr-inv-value-cell"
                          }
                        >
                          {references}
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  {/* Items and summary rows are ONE table (as in the template), so the
                      brown header repeats above the totals when they start a new page. */}
                  <table className="gr-inv-table gr-inv-items">
                    <colgroup>
                      <col style={{ width: "54%" }} />
                      <col style={{ width: "22%" }} />
                      <col style={{ width: "24%" }} />
                    </colgroup>
                    <thead>
                      <tr>
                        <th scope="col">{INVOICE_LABELS.items}</th>
                        <th scope="col" className="gr-inv-center">
                          {INVOICE_LABELS.weight}
                        </th>
                        <th scope="col" className="gr-inv-center">
                          {INVOICE_LABELS.pricePerLb}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="gr-inv-lines">
                      {items.map((row) => (
                        <tr key={row.key}>
                          <td>
                            {row.description}
                            {row.detail ? (
                              <span className="gr-inv-detail">{row.detail}</span>
                            ) : null}
                          </td>
                          <td className="gr-inv-num">{row.weight}</td>
                          <td className="gr-inv-num">{row.rate}</td>
                        </tr>
                      ))}
                      {Array.from({ length: padding }, (_, i) => (
                        <tr key={`pad-${i}`} aria-hidden="true">
                          <td />
                          <td />
                          <td />
                        </tr>
                      ))}
                    </tbody>
                    <tbody className="gr-inv-totals">
                      {summary.map((row) => (
                        <tr key={row.key}>
                          <th scope="row">{row.label}</th>
                          <td className="gr-inv-num">{row.weight ?? ""}</td>
                          <td className={row.emphasis ? "gr-inv-num gr-inv-strong" : "gr-inv-num"}>
                            {row.amount ?? ""}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  <div className="gr-inv-closing">
                    {meta.customerNote ? (
                      <>
                        <p className="gr-inv-heading">{INVOICE_LABELS.remarks}</p>
                        <p className="gr-inv-note">{meta.customerNote}</p>
                      </>
                    ) : null}

                    <p className="gr-inv-heading">{INVOICE_LABELS.paymentDetails}</p>
                    <table className="gr-inv-table gr-inv-bank">
                      <thead>
                        <tr>
                          {bank.map((c) => (
                            <th key={c.currency} scope="col">
                              {c.label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          {bank.map((c) => (
                            <td key={c.currency}>
                              <span>{INVOICE_LABELS.accountNumber}</span>
                              <span className="gr-inv-value">{c.accountNumber}</span>
                            </td>
                          ))}
                        </tr>
                        <tr>
                          {bank.map((c) => (
                            <td key={c.currency}>
                              <span>{INVOICE_LABELS.bank}</span>
                              <span className="gr-inv-value">{c.bankName}</span>
                            </td>
                          ))}
                        </tr>
                      </tbody>
                    </table>
                    <p className="gr-inv-instruction">{paymentInstruction(model)}</p>

                    {issuer.paymentTermsText ? (
                      <>
                        <p className="gr-inv-heading gr-inv-heading-small">
                          {INVOICE_LABELS.paymentTerms}
                        </p>
                        <p className="gr-inv-terms">{issuer.paymentTermsText}</p>
                      </>
                    ) : null}
                  </div>
                </div>
              </td>
            </tr>
          </tbody>
          {/* Reserves the footer's room at the bottom of every printed page: an
              invisible copy of the footer, so a footer that wraps reserves two lines. */}
          <tfoot aria-hidden="true">
            <tr>
              <td>
                <div className="gr-inv-footer-space">
                  {issuer.footerText ? (
                    <p className="gr-inv-footer-text">{issuer.footerText}</p>
                  ) : null}
                </div>
              </td>
            </tr>
          </tfoot>
        </table>

        {/* The running footer of every printed page repeats the company name (template
            grey #777777); screen readers already have it from the logo. */}
        {issuer.footerText ? (
          <p className="gr-inv-footer gr-inv-footer-text" aria-hidden="true">
            {issuer.footerText}
          </p>
        ) : null}
      </article>
    </div>
  );
}

/**
 * The document scaled to the width of its container (never wider than true
 * size): rendered at paper size and shrunk with transform: scale(), never
 * reflowed (SPEC §35.11). Prints unscaled.
 */
export function InvoicePreview({
  model,
  maxScale = 1,
  className,
  label,
}: {
  model: InvoiceRenderModel;
  maxScale?: number;
  className?: string;
  /** Accessible name of the preview region, e.g. "Voorbeeld van de factuur". */
  label?: string;
}) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const paper = PAPER_PX[model.issuer.paperSize];
  const [box, setBox] = useState<{ scale: number; height: number; left: number } | null>(null);

  useLayoutEffect(() => {
    const o = outer.current;
    const i = inner.current;
    if (!o || !i) return;
    const measure = () => {
      const width = o.clientWidth;
      if (width <= 0) return;
      const scale = Math.min(maxScale, width / paper.width);
      setBox({
        scale,
        height: Math.ceil(i.offsetHeight * scale),
        left: Math.max(0, (width - paper.width * scale) / 2),
      });
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(o);
    ro.observe(i);
    return () => ro.disconnect();
  }, [paper.width, maxScale]);

  return (
    <div
      ref={outer}
      className={className ? `gr-inv-scaler ${className}` : "gr-inv-scaler"}
      style={{ height: box ? box.height : paper.height * 0.5 }}
      role={label ? "region" : undefined}
      aria-label={label}
    >
      <div
        ref={inner}
        className="gr-inv-scaled"
        style={{
          width: paper.width,
          left: box?.left ?? 0,
          transform: `scale(${box?.scale ?? 0.5})`,
          visibility: box ? "visible" : "hidden",
        }}
      >
        <InvoiceDocument model={model} />
      </div>
    </div>
  );
}
