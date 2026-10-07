import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { customerDisplayName, customerSearchScore, type OrderCustomer } from "@/lib/admin/orders";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * Pick a customer by GR code or name (SPEC §26: find a customer quickly).
 * Customers without a login are marked; disabled customers cannot be chosen
 * (orders_before_insert refuses them).
 */
export function CustomerPicker({
  id,
  customers,
  value,
  onChange,
  disabled,
  invalid,
  describedBy,
}: {
  id: string;
  customers: readonly (OrderCustomer & { phone?: string | null })[];
  value: string | null;
  onChange: (customerId: string) => void;
  disabled?: boolean | undefined;
  invalid?: boolean | undefined;
  describedBy?: string | undefined;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const chosen = customers.find((c) => c.id === value) ?? null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-invalid={invalid ? true : undefined}
          aria-describedby={describedBy}
          disabled={disabled}
          className={cn(
            "h-auto min-h-11 w-full justify-between whitespace-normal py-2 text-left font-normal sm:min-h-10",
            invalid && "border-destructive",
          )}
        >
          {chosen ? (
            <span className="min-w-0">
              <span className="font-heading font-bold text-primary tabular-nums">
                {chosen.customer_code}
              </span>{" "}
              <span className="break-words">{customerDisplayName(chosen)}</span>
            </span>
          ) : (
            <span className="text-muted-foreground">{t("admin.newOrder.customerPlaceholder")}</span>
          )}
          <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-60" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] min-w-[min(20rem,calc(100vw-2rem))] p-0"
        align="start"
      >
        <Command filter={customerSearchScore}>
          <CommandInput placeholder={t("admin.newOrder.customerSearch")} />
          <CommandList>
            <CommandEmpty>{t("admin.newOrder.noCustomers")}</CommandEmpty>
            <CommandGroup>
              {customers.map((c) => {
                const disabledCustomer = c.status === "disabled";
                return (
                  <CommandItem
                    key={c.id}
                    value={c.customer_code}
                    keywords={[c.full_name, c.company_name ?? "", c.phone ?? ""]}
                    disabled={disabledCustomer}
                    onSelect={() => {
                      onChange(c.id);
                      setOpen(false);
                    }}
                    className="items-start"
                  >
                    <Check
                      className={cn("mt-0.5 size-4", value === c.id ? "opacity-100" : "opacity-0")}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1">
                      <span className="font-heading font-bold text-primary tabular-nums">
                        {c.customer_code}
                      </span>{" "}
                      <span className="break-words">{customerDisplayName(c)}</span>
                      <span className="mt-0.5 flex flex-wrap gap-1">
                        {c.user_id ? null : (
                          <Badge variant="outline" className="px-1.5 py-0 text-[0.7rem]">
                            {t("admin.newOrder.noLogin")}
                          </Badge>
                        )}
                        {disabledCustomer ? (
                          <Badge variant="neutral" className="px-1.5 py-0 text-[0.7rem]">
                            {t("admin.newOrder.disabledCustomer")}
                          </Badge>
                        ) : null}
                      </span>
                    </span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
