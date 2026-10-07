import { useQuery } from "@tanstack/react-query";
import { Check, ClipboardCopy, Copy, MapPinned } from "lucide-react";
import { useState } from "react";

import { LoadError } from "@/components/portal/Section";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { copyToClipboard } from "@/lib/clipboard";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";
import {
  fullAddressText,
  personalAddressLines,
  warehouseAddressesQueryOptions,
  type AddressPerson,
  type WarehouseAddress,
} from "@/lib/portal/warehouse";

/**
 * First dashboard card (SPEC §35.8): the customer's personal US shipping
 * address, read from warehouse_addresses and filled with their name and GR code.
 */
export function WarehouseAddressCard({
  userId,
  person,
}: {
  userId: string;
  person: AddressPerson;
}) {
  const t = useT();
  const addresses = useQuery(warehouseAddressesQueryOptions(userId));

  return (
    <section
      aria-labelledby="us-address-title"
      className="rounded-lg border-2 border-primary/25 bg-card p-5 shadow-sm sm:p-6"
    >
      <h2 id="us-address-title" className="flex items-center gap-2 text-lg text-primary sm:text-xl">
        <MapPinned className="size-5 shrink-0" aria-hidden />
        {t("portal.address.title")}
      </h2>

      {addresses.isPending ? (
        <div className="mt-4 space-y-2">
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-5 w-1/2" />
          <Skeleton className="h-5 w-3/5" />
        </div>
      ) : addresses.isError ? (
        <LoadError
          className="mt-4"
          title={t("portal.address.loadFailed")}
          error={addresses.error}
          onRetry={() => void addresses.refetch()}
        />
      ) : addresses.data.length === 0 ? (
        <p className="mt-3 text-sm leading-6 text-muted-foreground">{t("portal.address.empty")}</p>
      ) : (
        <>
          <p className="mt-2 max-w-prose text-sm leading-6 text-muted-foreground">
            {t("portal.address.intro")}
          </p>
          <div className={cn("mt-5 grid gap-5", addresses.data.length > 1 && "lg:grid-cols-2")}>
            {addresses.data.map((address) => (
              <AddressBlock
                key={address.id}
                address={address}
                person={person}
                showLabel={addresses.data.length > 1}
                wide={addresses.data.length === 1}
              />
            ))}
          </div>
          <p
            role="note"
            className="mt-5 rounded-md border border-warning/30 bg-warning-soft px-3 py-2.5 text-sm font-semibold leading-6 text-foreground"
          >
            {t("portal.address.note", { code: person.customerCode })}
          </p>
        </>
      )}
    </section>
  );
}

function AddressBlock({
  address,
  person,
  showLabel,
  wide,
}: {
  address: WarehouseAddress;
  person: AddressPerson;
  showLabel: boolean;
  /** A single address uses the card's full width: fields in two columns. */
  wide: boolean;
}) {
  const t = useT();
  const lines = personalAddressLines(address, person);

  return (
    <div className="min-w-0 rounded-md border bg-background/60">
      {showLabel ? (
        <p className="border-b bg-cream px-4 py-2 text-sm font-bold text-primary">
          {address.label} · {t(`portal.serviceTypes.${address.service_type}`)}
        </p>
      ) : null}
      {/* A list rather than <dl>: each row also holds its copy button. */}
      <ul
        className={cn(
          wide
            ? "grid sm:grid-cols-2 [&>li]:border-b sm:[&>li:nth-child(odd)]:border-r"
            : "divide-y [&>li:last-child]:border-b",
        )}
      >
        {lines.map((line) => {
          const label = t(`portal.address.fields.${line.field}`);
          return (
            <li key={line.field} className="flex items-center gap-3 px-4 py-2">
              <div className="min-w-0 flex-1">
                <span className="block text-xs text-muted-foreground">{label}</span>
                <span className="block break-words font-semibold text-foreground tabular-nums">
                  {line.value}
                </span>
              </div>
              <CopyIconButton
                text={line.value}
                label={t("portal.address.copyField", { field: label })}
              />
            </li>
          );
        })}
      </ul>
      <div className="p-3">
        <Button
          variant="outline"
          size="sm"
          className="w-full sm:w-auto"
          onClick={() => void copyToClipboard(fullAddressText(address, person))}
        >
          <ClipboardCopy aria-hidden />
          {t("portal.address.copyAll")}
        </Button>
      </div>
    </div>
  );
}

function CopyIconButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="ghost"
      size="icon"
      className="shrink-0 text-primary"
      title={label}
      onClick={async () => {
        if (await copyToClipboard(text)) {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        }
      }}
    >
      {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
      <span className="sr-only">{label}</span>
    </Button>
  );
}
