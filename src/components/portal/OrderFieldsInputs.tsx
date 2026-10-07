import { useId, useRef, useState, type ReactNode } from "react";
import type { UseFormReturn } from "react-hook-form";
import { Info, Lock } from "lucide-react";

import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Constants } from "@/integrations/supabase/types";
import { formatDate, todayInSuriname } from "@/lib/format";
import { useT } from "@/lib/i18n";
import {
  COMMON_CARRIERS,
  PLANNED_PURCHASE_MAX_YEARS_AHEAD,
  carrierChoice,
  isCalendarDate,
  isGrPurchase,
  shiftYears,
  type CarrierChoice,
  type OrderFieldsInput,
  type OrderFieldsOutput,
} from "@/lib/portal/order-fields";
import type { ServiceType } from "@/lib/portal/orders";
import { cn } from "@/lib/utils";

export type OrderFieldsForm = UseFormReturn<OrderFieldsInput, unknown, OrderFieldsOutput>;

/** 44 px touch targets on phones, the usual 40 px from the sm breakpoint. */
const FIELD = "h-11 sm:h-10";
const NO_PURCHASE_MODE = "none" as const;

/**
 * The customer-editable order fields (SPEC §9, §35.7; schema in
 * lib/portal/order-fields.ts), for use inside a react-hook-form <Form>.
 * `serviceTypes` are the enabled ones (service_rates.enabled); the order's
 * current type stays selectable so an edit does not silently change it.
 *
 * variant "register": the order type was chosen in step 1 (so no radio
 * here), and the estimated value and purchase date are required
 * (order-schema.ts). `locked` shows the fields one purchase shares read-only:
 * on an extra package they come from the root order, and on a root order with
 * packages they hold for all of them.
 */
export function OrderFieldsInputs({
  form,
  serviceTypes,
  idPrefix,
  variant = "edit",
  locked,
  lockedHint,
}: {
  form: OrderFieldsForm;
  serviceTypes: readonly ServiceType[];
  idPrefix: string;
  variant?: "edit" | "register";
  locked?: { orderType?: boolean; storeVendor?: boolean; vendorOrderNumber?: boolean } | undefined;
  lockedHint?: string | undefined;
}) {
  const t = useT();
  const register = variant === "register";
  const orderType = form.watch("orderType");
  const purchaseMode = form.watch("purchaseMode");
  const currentService = form.watch("serviceType");
  const purchaseDate = form.watch("purchaseDate");
  const expectedDeliveryDate = form.watch("expectedDeliveryDate");
  const serviceOptions = Constants.public.Enums.service_type.filter(
    (s) => serviceTypes.includes(s) || s === currentService,
  );
  const today = todayInSuriname();
  // A purchase G&R still has to make: store (or supplier), value and date may be unknown yet.
  const grPurchase = isGrPurchase({ orderType, purchaseMode });
  const valueRequired = register && !grPurchase;

  return (
    <div className="space-y-8">
      <FieldGroup
        title={
          register ? t("portal.orderForm.sections.service") : t("portal.orderForm.sections.type")
        }
      >
        {register ? null : locked?.orderType ? (
          <div className="space-y-2">
            <p className="text-sm font-medium leading-none" id={`${idPrefix}-order-type`}>
              {t("portal.orderForm.fields.orderType")}
            </p>
            <p
              aria-labelledby={`${idPrefix}-order-type`}
              className="flex min-h-11 items-center rounded-md border bg-muted px-3 text-sm font-semibold sm:min-h-10"
            >
              {t(`portal.orderTypes.${orderType}`)}
            </p>
            {lockedHint ? (
              <p className="text-[0.8rem] text-muted-foreground">
                <LockedHint text={lockedHint} />
              </p>
            ) : null}
          </div>
        ) : (
          <FormField
            control={form.control}
            name="orderType"
            render={({ field }) => (
              <FormItem>
                <FormLabel id={`${idPrefix}-order-type`}>
                  {t("portal.orderForm.fields.orderType")}
                </FormLabel>
                <FormControl>
                  <RadioGroup
                    aria-labelledby={`${idPrefix}-order-type`}
                    value={field.value}
                    onValueChange={field.onChange}
                    className="grid gap-3 sm:grid-cols-2"
                  >
                    {Constants.public.Enums.order_type.map((type) => (
                      <ChoiceLabel key={type} selected={field.value === type}>
                        <RadioGroupItem value={type} className="mt-0.5" />
                        <span>
                          <span className="block font-semibold">
                            {t(`portal.orderTypes.${type}`)}
                          </span>
                          <span className="block text-xs text-muted-foreground">
                            {t(`portal.orderForm.orderTypeHints.${type}`)}
                          </span>
                        </span>
                      </ChoiceLabel>
                    ))}
                  </RadioGroup>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        )}
        <FormField
          control={form.control}
          name="serviceType"
          render={({ field }) => (
            <FormItem>
              <FormLabel id={`${idPrefix}-service-type`}>
                {t("portal.orderForm.fields.serviceType")}
              </FormLabel>
              <FormControl>
                <RadioGroup
                  aria-labelledby={`${idPrefix}-service-type`}
                  value={field.value}
                  onValueChange={field.onChange}
                  className="grid gap-3 sm:grid-cols-2"
                >
                  {serviceOptions.map((type) => (
                    <ChoiceLabel key={type} selected={field.value === type}>
                      <RadioGroupItem value={type} className="mt-0.5" />
                      <span className="font-semibold">{t(`portal.serviceTypes.${type}`)}</span>
                    </ChoiceLabel>
                  ))}
                </RadioGroup>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </FieldGroup>

      {orderType === "b2b" ? (
        <FieldGroup title={t("portal.orderForm.sections.b2b")}>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="supplierName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {t("portal.orderForm.fields.supplierName")} <OptionalMark />
                  </FormLabel>
                  <FormControl>
                    <Input
                      className={FIELD}
                      maxLength={200}
                      {...field}
                      onChange={(e) => {
                        field.onChange(e);
                        // For a G&R purchase the supplier can stand in for the store.
                        if (form.formState.isSubmitted) void form.trigger("storeVendor");
                      }}
                    />
                  </FormControl>
                  <FormDescription>{t("portal.orderForm.fields.supplierNameHint")}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="clientPoNumber"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {t("portal.orderForm.fields.clientPoNumber")} <OptionalMark />
                  </FormLabel>
                  <FormControl>
                    <Input
                      className={FIELD}
                      maxLength={100}
                      autoComplete="off"
                      spellCheck={false}
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    {t("portal.orderForm.fields.clientPoNumberHint")}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
          <FormField
            control={form.control}
            name="purchaseMode"
            render={({ field }) => (
              <FormItem>
                <FormLabel id={`${idPrefix}-purchase-mode`}>
                  {t("portal.orderForm.fields.purchaseMode")} <OptionalMark />
                </FormLabel>
                <FormControl>
                  <RadioGroup
                    aria-labelledby={`${idPrefix}-purchase-mode`}
                    value={field.value === "" ? NO_PURCHASE_MODE : field.value}
                    onValueChange={(v) => {
                      field.onChange(v === NO_PURCHASE_MODE ? "" : v);
                      // Which purchase fields are required depends on this choice.
                      if (form.formState.isSubmitted) {
                        void form.trigger(["storeVendor", "estimatedValue", "purchaseDate"]);
                      }
                    }}
                    className="grid gap-3 lg:grid-cols-3"
                  >
                    {[...Constants.public.Enums.purchase_mode, NO_PURCHASE_MODE].map((mode) => {
                      const selected =
                        (field.value === "" ? NO_PURCHASE_MODE : field.value) === mode;
                      return (
                        <ChoiceLabel key={mode} selected={selected}>
                          <RadioGroupItem value={mode} className="mt-0.5" />
                          <span>
                            <span className="block font-semibold">
                              {mode === NO_PURCHASE_MODE
                                ? t("portal.orderForm.fields.purchaseModeNone")
                                : t(`portal.purchaseModes.${mode}`)}
                            </span>
                            <span className="block text-xs leading-5 text-muted-foreground">
                              {mode === NO_PURCHASE_MODE
                                ? t("portal.orderForm.purchaseModeHints.none")
                                : t(`portal.orderForm.purchaseModeHints.${mode}`)}
                            </span>
                          </span>
                        </ChoiceLabel>
                      );
                    })}
                  </RadioGroup>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </FieldGroup>
      ) : null}

      <FieldGroup title={t("portal.orderForm.sections.purchase")}>
        {grPurchase ? (
          <p className="flex items-start gap-2 rounded-md border bg-cream px-3 py-2.5 text-sm leading-6 text-foreground">
            <Info className="mt-1 size-4 shrink-0 text-primary" aria-hidden />
            {t("portal.orderForm.grPurchaseNote")}
          </p>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="storeVendor"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  {t("portal.orderForm.fields.storeVendor")} {grPurchase ? <OptionalMark /> : null}
                </FormLabel>
                <FormControl>
                  <Input
                    className={cn(FIELD, locked?.storeVendor && "bg-muted")}
                    maxLength={200}
                    aria-required={grPurchase ? undefined : true}
                    readOnly={locked?.storeVendor}
                    {...field}
                  />
                </FormControl>
                <FormDescription>
                  {locked?.storeVendor && lockedHint ? (
                    <LockedHint text={lockedHint} />
                  ) : grPurchase ? (
                    t("portal.orderForm.fields.storeVendorGrHint")
                  ) : (
                    t("portal.orderForm.fields.storeVendorHint")
                  )}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="vendorOrderNumber"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  {t("portal.orderForm.fields.vendorOrderNumber")} <OptionalMark />
                </FormLabel>
                <FormControl>
                  <Input
                    className={cn(FIELD, locked?.vendorOrderNumber && "bg-muted")}
                    maxLength={100}
                    autoComplete="off"
                    spellCheck={false}
                    readOnly={locked?.vendorOrderNumber}
                    {...field}
                  />
                </FormControl>
                {locked?.vendorOrderNumber && lockedHint ? (
                  <FormDescription>
                    <LockedHint text={lockedHint} />
                  </FormDescription>
                ) : null}
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("portal.orderForm.fields.description")}</FormLabel>
              <FormControl>
                <Textarea rows={3} maxLength={2000} aria-required {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <FormField
            control={form.control}
            name="quantity"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("portal.orderForm.fields.quantity")}</FormLabel>
                <FormControl>
                  <Input
                    className={FIELD}
                    inputMode="numeric"
                    pattern="[0-9]*"
                    autoComplete="off"
                    aria-required
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <div className="grid grid-cols-[minmax(0,1fr)_6.5rem] gap-3">
            <FormField
              control={form.control}
              name="estimatedValue"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {t("portal.orderForm.fields.estimatedValue")}{" "}
                    {valueRequired ? null : <OptionalMark />}
                  </FormLabel>
                  <FormControl>
                    <Input
                      className={FIELD}
                      inputMode="decimal"
                      autoComplete="off"
                      aria-required={valueRequired || undefined}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="estimatedValueCurrency"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("portal.orderForm.fields.currency")}</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger className={FIELD}>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {Constants.public.Enums.currency_code.map((c) => (
                        <SelectItem key={c} value={c}>
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="purchaseDate"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  {grPurchase
                    ? t("portal.orderForm.fields.plannedPurchaseDate")
                    : t("portal.orderForm.fields.purchaseDate")}{" "}
                  {valueRequired ? null : <OptionalMark />}
                </FormLabel>
                <FormControl>
                  <Input
                    type="date"
                    className={FIELD}
                    max={grPurchase ? shiftYears(today, PLANNED_PURCHASE_MAX_YEARS_AHEAD) : today}
                    aria-required={valueRequired || undefined}
                    {...field}
                  />
                </FormControl>
                <ChosenDate value={purchaseDate} />
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="expectedDeliveryDate"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  {t("portal.orderForm.fields.expectedDeliveryDate")} <OptionalMark />
                </FormLabel>
                <FormControl>
                  <Input type="date" className={FIELD} min={purchaseDate || undefined} {...field} />
                </FormControl>
                <ChosenDate value={expectedDeliveryDate} />
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
      </FieldGroup>

      <FieldGroup title={t("portal.orderForm.sections.tracking")}>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="trackingNumber"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  {t("portal.orderForm.fields.trackingNumber")}{" "}
                  <span className="font-normal text-muted-foreground">
                    ({t("portal.orderForm.fields.trackingHint")})
                  </span>
                </FormLabel>
                <FormControl>
                  <Input
                    className={FIELD}
                    maxLength={100}
                    autoComplete="off"
                    autoCapitalize="characters"
                    spellCheck={false}
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="carrier"
            render={({ field }) => (
              <CarrierField value={field.value} onChange={field.onChange} onBlur={field.onBlur} />
            )}
          />
        </div>
        <FormField
          control={form.control}
          name="declaredWeightLbs"
          render={({ field }) => (
            <FormItem className="sm:max-w-[calc(50%-0.5rem)]">
              <FormLabel>
                {t("portal.orderForm.fields.declaredWeight")} <OptionalMark />
              </FormLabel>
              <FormControl>
                <Input className={FIELD} inputMode="decimal" autoComplete="off" {...field} />
              </FormControl>
              <FormDescription>{t("portal.orderForm.fields.declaredWeightHint")}</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
      </FieldGroup>

      <FieldGroup title={t("portal.orderForm.sections.note")}>
        <FormField
          control={form.control}
          name="customerNote"
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                {t("portal.orderForm.fields.customerNote")} <OptionalMark />
              </FormLabel>
              <FormControl>
                <Textarea rows={3} maxLength={2000} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </FieldGroup>
    </div>
  );
}

/**
 * Carrier: the usual carriers as a list, "Anders" for a typed name, "Nog niet
 * bekend" for none. The column stays free text (order-fields.ts).
 */
function CarrierField({
  value,
  onChange,
  onBlur,
}: {
  value: string;
  onChange: (value: string) => void;
  onBlur: () => void;
}) {
  const t = useT();
  const otherId = useId();
  const otherRef = useRef<HTMLInputElement>(null);
  // "Anders" with nothing typed yet must stay "Anders", so the choice is state.
  const [choice, setChoice] = useState<CarrierChoice>(() => carrierChoice(value));

  return (
    <FormItem>
      <FormLabel>
        {t("portal.orderForm.fields.carrier")} <OptionalMark />
      </FormLabel>
      <Select
        value={choice}
        onValueChange={(next) => {
          const picked = next as CarrierChoice;
          setChoice(picked);
          if (picked === "unknown") onChange("");
          else if (picked === "other") {
            onChange(carrierChoice(value) === "other" ? value : "");
            // Let the text field render first.
            setTimeout(() => otherRef.current?.focus(), 0);
          } else onChange(picked);
        }}
      >
        <FormControl>
          <SelectTrigger className={FIELD} onBlur={onBlur}>
            <SelectValue />
          </SelectTrigger>
        </FormControl>
        <SelectContent>
          <SelectItem value="unknown">{t("portal.orderForm.fields.carrierUnknown")}</SelectItem>
          {COMMON_CARRIERS.map((c) => (
            <SelectItem key={c} value={c}>
              {c}
            </SelectItem>
          ))}
          <SelectItem value="other">{t("portal.orderForm.fields.carrierOther")}</SelectItem>
        </SelectContent>
      </Select>
      {choice === "other" ? (
        <div className="space-y-1.5 pt-1">
          <Label htmlFor={otherId} className="text-xs font-medium text-muted-foreground">
            {t("portal.orderForm.fields.carrierOtherLabel")}
          </Label>
          <Input
            ref={otherRef}
            id={otherId}
            className={FIELD}
            maxLength={100}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onBlur={onBlur}
          />
        </div>
      ) : null}
      <FormDescription>{t("portal.orderForm.fields.carrierHint")}</FormDescription>
      <FormMessage />
    </FormItem>
  );
}

function FieldGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="min-w-0 space-y-4">
      <legend className="mb-3 font-heading text-base font-bold text-primary">{title}</legend>
      {children}
    </fieldset>
  );
}

function ChoiceLabel({ selected, children }: { selected: boolean; children: ReactNode }) {
  return (
    <label
      className={cn(
        "flex min-h-11 cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5 text-sm",
        selected ? "border-primary bg-cream" : "border-border",
      )}
    >
      {children}
    </label>
  );
}

function LockedHint({ text }: { text: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Lock className="size-3.5 shrink-0" aria-hidden />
      {text}
    </span>
  );
}

/**
 * The chosen date in dd-mm-jjjj (SPEC §35.10) under a date field: the
 * browser shows the field in its own locale (e.g. mm/dd/yyyy), so 05/10
 * cannot silently mean 10 May.
 */
function ChosenDate({ value }: { value: string }) {
  const t = useT();
  if (!isCalendarDate(value)) return null;
  return (
    <FormDescription className="tabular-nums">
      {t("portal.orderForm.fields.dateChosen", { date: formatDate(value) })}
    </FormDescription>
  );
}

function OptionalMark() {
  const t = useT();
  return (
    <span className="font-normal text-muted-foreground">({t("portal.orderForm.optional")})</span>
  );
}
