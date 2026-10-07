import { ArrowDown, ArrowUp, Info, Plus, Trash2, TriangleAlert } from "lucide-react";

import { FieldError } from "@/components/admin/Callout";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  EXTRA_LINE_TYPES,
  changeLineType,
  fieldDomId,
  isOrderedLine,
  lineField,
  weightNoteText,
  type BuilderErrors,
  type BuilderLine,
  type BuilderOrder,
  type ExtraLineType,
} from "@/lib/admin/invoice-builder";
import { formatMoney, type CurrencyCode } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { lineAmount } from "@/lib/invoice/totals";
import { parseDecimalInput } from "@/lib/admin/settings";
import { cn } from "@/lib/utils";

const errorId = (field: string) => `${fieldDomId(field)}-error`;

const NO_ORDER = "__none__";

/**
 * The lines of the builder: freight lines (one per picked order: weight and
 * rate per lb) and hand-added lines (customs, handling, goods, service fee,
 * other, discount). Remove, all fields with their own errors, and move up or
 * down where the order shows on the paper (freight among freight, "Overige
 * kosten" among each other; `canMove` says when).
 */
export function BuilderLines({
  lines,
  orders,
  currency,
  vatConfigured,
  errors,
  onChange,
  onAdd,
  onRemove,
  onMove,
  canMove,
}: {
  lines: readonly BuilderLine[];
  orders: readonly BuilderOrder[];
  currency: CurrencyCode;
  /** BTW set in the settings: then the exemption checkbox matters and is shown. */
  vatConfigured: boolean;
  errors: BuilderErrors;
  onChange: (key: string, patch: Partial<BuilderLine>) => void;
  onAdd: (type: ExtraLineType) => void;
  onRemove: (key: string) => void;
  onMove: (key: string, by: -1 | 1) => void;
  canMove: (key: string, by: -1 | 1) => boolean;
}) {
  const t = useT();
  const picked = orders.filter((o) => lines.some((l) => l.orderId === o.id));

  return (
    <div className="space-y-3">
      {lines.length === 0 ? (
        <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
          {t("admin.invoiceBuilder.lines.empty")}
        </p>
      ) : (
        <ol className="space-y-3">
          {lines.map((line, index) => (
            <LineEditor
              key={line.key}
              line={line}
              index={index}
              canMoveUp={canMove(line.key, -1)}
              canMoveDown={canMove(line.key, 1)}
              order={orders.find((o) => o.id === line.orderId) ?? null}
              orders={picked}
              currency={currency}
              vatConfigured={vatConfigured}
              errors={errors}
              onChange={(patch) => onChange(line.key, patch)}
              onRemove={() => onRemove(line.key)}
              onMove={(by) => onMove(line.key, by)}
            />
          ))}
        </ol>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline" className="w-full sm:w-auto">
            <Plus aria-hidden />
            {t("admin.invoiceBuilder.lines.add")}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {EXTRA_LINE_TYPES.map((type) => (
            <DropdownMenuItem key={type} onSelect={() => onAdd(type)}>
              {t(`admin.invoiceBuilder.lines.types.${type}`)}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function LineEditor({
  line,
  index,
  canMoveUp,
  canMoveDown,
  order,
  orders,
  currency,
  vatConfigured,
  errors,
  onChange,
  onRemove,
  onMove,
}: {
  line: BuilderLine;
  index: number;
  canMoveUp: boolean;
  canMoveDown: boolean;
  order: BuilderOrder | null;
  orders: readonly BuilderOrder[];
  currency: CurrencyCode;
  vatConfigured: boolean;
  errors: BuilderErrors;
  onChange: (patch: Partial<BuilderLine>) => void;
  onRemove: () => void;
  onMove: (by: -1 | 1) => void;
}) {
  const t = useT();
  const freight = line.lineType === "freight";
  const n = index + 1;
  const typeLabel = t(`admin.invoiceBuilder.lines.types.${line.lineType}`);
  const field = (f: Parameters<typeof lineField>[1]) => lineField(line.key, f);
  const err = (f: Parameters<typeof lineField>[1]) => errors[field(f)] ?? null;
  const described = (f: Parameters<typeof lineField>[1], hint?: string) =>
    [err(f) ? errorId(field(f)) : null, hint ?? null].filter(Boolean).join(" ") || undefined;

  // The line total as the database will store it (freight = weight × rate, rounded half-up).
  const weight = parseDecimalInput(line.weight.replace(/\s/g, ""));
  const rate = parseDecimalInput(line.rate.replace(/\s/g, ""));
  const amount = parseDecimalInput(line.amount.replace(/\s/g, ""));
  const total = freight
    ? weight !== null && rate !== null
      ? lineAmount({ lineType: "freight", weightLbs: weight, ratePerLb: rate, vatExempt: false })
      : null
    : amount !== null
      ? line.lineType === "discount"
        ? -amount
        : amount
      : null;
  const weightHint = line.weightNote ? `${fieldDomId(field("weight"))}-note` : undefined;

  return (
    <li
      className={cn(
        "@container rounded-md border bg-card p-3 sm:p-4",
        freight ? "border-primary/30" : "border-border",
      )}
      aria-label={t("admin.invoiceBuilder.lines.lineLabel", { index: n, type: typeLabel })}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          {freight ? (
            <p className="text-sm font-semibold text-primary">
              {order
                ? t("admin.invoiceBuilder.lines.freightFor", { reference: order.reference })
                : typeLabel}
            </p>
          ) : (
            <div className="space-y-1">
              <Label htmlFor={fieldDomId(field("description")) + "-type"} className="sr-only">
                {t("admin.invoiceBuilder.lines.type")}
              </Label>
              <Select
                value={line.lineType}
                onValueChange={(value) => {
                  const type = EXTRA_LINE_TYPES.find((x) => x === value);
                  if (type) onChange(changeLineType(line, type));
                }}
              >
                <SelectTrigger
                  id={fieldDomId(field("description")) + "-type"}
                  className="h-9 w-[min(16rem,70vw)] font-semibold text-primary"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EXTRA_LINE_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {t(`admin.invoiceBuilder.lines.types.${type}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <FieldError id={errorId(field("order"))} message={err("order")} />
        </div>
        <div className="flex shrink-0 gap-1">
          {/* Only where the order shows on the paper; other charges print in a fixed place. */}
          {isOrderedLine(line) ? (
            <>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-9"
                disabled={!canMoveUp}
                onClick={() => onMove(-1)}
                aria-label={t("admin.invoiceBuilder.lines.moveUp", { index: n })}
              >
                <ArrowUp aria-hidden />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-9"
                disabled={!canMoveDown}
                onClick={() => onMove(1)}
                aria-label={t("admin.invoiceBuilder.lines.moveDown", { index: n })}
              >
                <ArrowDown aria-hidden />
              </Button>
            </>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-9 text-destructive hover:text-destructive"
            onClick={onRemove}
            aria-label={t("admin.invoiceBuilder.lines.remove", { index: n })}
          >
            <Trash2 aria-hidden />
          </Button>
        </div>
      </div>

      <div className="mt-3 grid gap-3">
        <div className="space-y-1.5">
          <Label htmlFor={fieldDomId(field("description"))}>
            {t("admin.invoiceBuilder.lines.description")}
          </Label>
          <Input
            id={fieldDomId(field("description"))}
            value={line.description}
            maxLength={500}
            onChange={(e) => onChange({ description: e.target.value })}
            aria-invalid={err("description") ? true : undefined}
            aria-describedby={described(
              "description",
              line.lineType === "other" || !freight
                ? `${fieldDomId(field("description"))}-hint`
                : undefined,
            )}
          />
          {!freight ? (
            <p
              id={`${fieldDomId(field("description"))}-hint`}
              className="text-xs text-muted-foreground"
            >
              {line.lineType === "other"
                ? t("admin.invoiceBuilder.lines.descriptionOtherHint")
                : t("admin.invoiceBuilder.lines.descriptionHint")}
            </p>
          ) : null}
          <FieldError id={errorId(field("description"))} message={err("description")} />
        </div>

        {freight ? (
          <div className="grid gap-3 @md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={fieldDomId(field("weight"))}>
                {t("admin.invoiceBuilder.lines.weight")}
              </Label>
              <Input
                id={fieldDomId(field("weight"))}
                inputMode="decimal"
                autoComplete="off"
                value={line.weight}
                onChange={(e) => onChange({ weight: e.target.value })}
                aria-invalid={err("weight") ? true : undefined}
                aria-describedby={described("weight", weightHint)}
                className="tabular-nums"
              />
              {line.weightNote ? (
                <p
                  id={weightHint}
                  className={cn(
                    "flex items-start gap-1.5 text-xs",
                    line.weightNote.kind === "measured"
                      ? "text-muted-foreground"
                      : "font-medium text-warning",
                  )}
                >
                  {line.weightNote.kind === "measured" ? (
                    <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                  ) : (
                    <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                  )}
                  {weightNoteText(line.weightNote)}
                </p>
              ) : null}
              <FieldError id={errorId(field("weight"))} message={err("weight")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={fieldDomId(field("rate"))}>
                {t("admin.invoiceBuilder.lines.rate", { currency })}
              </Label>
              <Input
                id={fieldDomId(field("rate"))}
                inputMode="decimal"
                autoComplete="off"
                value={line.rate}
                onChange={(e) => onChange({ rate: e.target.value })}
                aria-invalid={err("rate") ? true : undefined}
                aria-describedby={described("rate")}
                className="tabular-nums"
              />
              <FieldError id={errorId(field("rate"))} message={err("rate")} />
            </div>
          </div>
        ) : (
          <div className="grid gap-3 @md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={fieldDomId(field("amount"))}>
                {line.lineType === "discount"
                  ? t("admin.invoiceBuilder.lines.discountAmount", { currency })
                  : t("admin.invoiceBuilder.lines.amount", { currency })}
              </Label>
              <Input
                id={fieldDomId(field("amount"))}
                inputMode="decimal"
                autoComplete="off"
                value={line.amount}
                onChange={(e) => onChange({ amount: e.target.value })}
                aria-invalid={err("amount") ? true : undefined}
                aria-describedby={described("amount")}
                className="tabular-nums"
              />
              <FieldError id={errorId(field("amount"))} message={err("amount")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={fieldDomId(field("order"))}>
                {t("admin.invoiceBuilder.lines.order")}
              </Label>
              <Select
                value={line.orderId ?? NO_ORDER}
                onValueChange={(value) => onChange({ orderId: value === NO_ORDER ? null : value })}
              >
                <SelectTrigger id={fieldDomId(field("order"))} className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_ORDER}>
                    {t("admin.invoiceBuilder.lines.noOrder")}
                  </SelectItem>
                  {orders.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.reference}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          {vatConfigured ? (
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={line.vatExempt}
                onCheckedChange={(checked) => onChange({ vatExempt: checked === true })}
              />
              {t("admin.invoiceBuilder.lines.vatExempt")}
            </label>
          ) : (
            <span />
          )}
          <p className="text-sm font-semibold tabular-nums text-foreground" aria-live="polite">
            {total === null
              ? null
              : t("admin.invoiceBuilder.lines.lineTotal", { amount: formatMoney(total, currency) })}
          </p>
        </div>
      </div>
    </li>
  );
}
