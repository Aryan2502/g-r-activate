import { Fragment } from "react";

import { formatMoney } from "@/lib/format";
import type { CurrencyAmount } from "@/lib/portal/invoices";

/**
 * "USD 245,00 · SRD 1.250,00": amounts per currency, never summed across
 * currencies (SPEC §35.10); a line only breaks between currencies.
 */
export function CurrencyAmounts({ amounts }: { amounts: readonly CurrencyAmount[] }) {
  return (
    <>
      {amounts.map((a, i) => (
        <Fragment key={a.currency}>
          <span className="whitespace-nowrap tabular-nums">
            {formatMoney(a.amount, a.currency)}
            {i < amounts.length - 1 ? " ·" : ""}
          </span>
          {i < amounts.length - 1 ? " " : null}
        </Fragment>
      ))}
    </>
  );
}
