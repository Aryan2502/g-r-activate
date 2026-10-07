import { useId, useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import {
  AlertTriangle,
  CircleCheck,
  CircleOff,
  Loader2,
  MapPin,
  Pencil,
  Plus,
  Power,
} from "lucide-react";
import { toast } from "sonner";

import { CustomerPicker } from "@/components/admin/CustomerPicker";
import { Problem } from "@/components/admin/customers/CustomerActionDialogs";
import { TextField } from "@/components/admin/customers/CustomerFormFields";
import { fieldErrorsOf } from "@/components/admin/customers/form-state";
import { SelectField, SwitchField } from "@/components/admin/settings/SettingFields";
import { LoadError } from "@/components/portal/Section";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { customerListQueryOptions, type CustomerListRow } from "@/lib/admin/customers";
import { adminKeys } from "@/lib/admin/keys";
import {
  EMPTY_WAREHOUSE_ADDRESS,
  PLACEHOLDER_VARS,
  SERVICE_TYPES,
  saveWarehouseAddress,
  setWarehouseAddressActive,
  warehouseAddressSchema,
  warehouseInputValues,
  warehouseWarnings,
  type WarehouseAddressRow,
  type WarehouseAddressValues,
} from "@/lib/admin/settings";
import { errorMessage } from "@/lib/errors";
import { useT } from "@/lib/i18n";
import {
  personalAddressLines,
  type AddressPerson,
  type WarehouseAddress,
} from "@/lib/portal/warehouse";

const FIELDS = [
  "label",
  "serviceType",
  "recipientTemplate",
  "line1",
  "line2Template",
  "city",
  "state",
  "zip",
  "country",
  "phone",
  "active",
] as const;
type Field = (typeof FIELDS)[number];

/** Clearly not a real customer, for when there are none yet. */
const SAMPLE_CODE = "GR12345";

/**
 * "US-verzendadressen" (SPEC §35.8): the address customers have their
 * parcels sent to, with {FULL_NAME} and {GR_CODE} filled in per customer.
 * Never seeded or invented; admins add, change and switch addresses off
 * (never delete). Every address shows how a customer sees it.
 */
export function WarehousePanel({
  userId,
  isAdmin,
  addresses,
}: {
  userId: string;
  isAdmin: boolean;
  addresses: UseQueryResult<WarehouseAddressRow[]>;
}) {
  const t = useT();
  const customers = useQuery(customerListQueryOptions(userId));
  const [editing, setEditing] = useState<WarehouseAddressRow | "new" | null>(null);
  const firstCustomer = customers.data?.find((c) => c.status !== "disabled") ?? null;
  const person: AddressPerson = firstCustomer
    ? { fullName: firstCustomer.full_name, customerCode: firstCustomer.customer_code }
    : { fullName: t("admin.settings.warehouse.sampleName"), customerCode: SAMPLE_CODE };

  if (addresses.isError) {
    return (
      <LoadError
        title={t("admin.settings.warehouse.loadFailed")}
        error={addresses.error}
        onRetry={() => void addresses.refetch()}
      />
    );
  }
  if (addresses.isPending) return <Skeleton className="h-40 w-full" />;

  return (
    <div className="space-y-4">
      {isAdmin ? (
        <Button variant="outline" onClick={() => setEditing("new")} className="w-full sm:w-auto">
          <Plus aria-hidden />
          {t("admin.settings.warehouse.add")}
        </Button>
      ) : null}
      {addresses.data.length === 0 ? (
        <p className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-sm text-foreground">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          {t("admin.settings.warehouse.none")}
        </p>
      ) : (
        <ul className="grid gap-4 lg:grid-cols-2">
          {addresses.data.map((address) => (
            <AddressCard
              key={address.id}
              userId={userId}
              address={address}
              person={person}
              isAdmin={isAdmin}
              onEdit={() => setEditing(address)}
            />
          ))}
        </ul>
      )}
      {isAdmin && editing ? (
        <WarehouseAddressDialog
          key={editing === "new" ? "new" : editing.id}
          userId={userId}
          address={editing === "new" ? null : editing}
          customers={customers.data ?? []}
          initialCustomerId={firstCustomer?.id ?? null}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}

function PersonalPreview({
  address,
  person,
  heading,
}: {
  address: WarehouseAddress;
  person: AddressPerson;
  heading: string;
}) {
  const t = useT();
  const lines = personalAddressLines(address, person);
  return (
    <div className="rounded-md border border-dashed bg-cream/40 p-3 text-sm">
      <p className="text-xs font-semibold text-muted-foreground">{heading}</p>
      <dl className="mt-2 space-y-1">
        {lines.map((line) => (
          <div key={line.field} className="grid grid-cols-[7.5rem_1fr] gap-2">
            <dt className="text-muted-foreground">{t(`portal.address.fields.${line.field}`)}</dt>
            <dd className="min-w-0 break-words font-medium text-foreground">{line.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function AddressCard({
  userId,
  address,
  person,
  isAdmin,
  onEdit,
}: {
  userId: string;
  address: WarehouseAddressRow;
  person: AddressPerson;
  isAdmin: boolean;
  onEdit: () => void;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const toggle = useMutation({
    mutationFn: () => setWarehouseAddressActive(supabase, address.id, !address.is_active),
    onSuccess: async (saved) => {
      toast.success(
        saved.is_active
          ? t("admin.settings.warehouse.activated", { label: saved.label })
          : t("admin.settings.warehouse.deactivated", { label: saved.label }),
      );
      await queryClient.invalidateQueries({ queryKey: adminKeys.config(userId) });
    },
    onError: (e) => toast.error(`${t("admin.settings.warehouse.toggleFailed")} ${errorMessage(e)}`),
  });

  return (
    <li className="min-w-0 space-y-3 rounded-md border p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 break-words text-base font-semibold text-foreground">
            <MapPin className="size-4 shrink-0 text-primary" aria-hidden />
            {address.label}
          </h3>
          <p className="text-sm text-muted-foreground">
            {t(`portal.serviceTypes.${address.service_type}`)}
          </p>
        </div>
        {address.is_active ? (
          <Badge variant="success">
            <CircleCheck className="size-3.5 shrink-0" aria-hidden />
            {t("admin.settings.warehouse.active")}
          </Badge>
        ) : (
          <Badge variant="neutral">
            <CircleOff className="size-3.5 shrink-0" aria-hidden />
            {t("admin.settings.warehouse.inactive")}
          </Badge>
        )}
      </div>
      <PersonalPreview
        address={address}
        person={person}
        heading={t("admin.settings.warehouse.previewFor", {
          name: person.fullName,
          code: person.customerCode,
        })}
      />
      {isAdmin ? (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={onEdit}
            aria-label={t("admin.settings.warehouse.editLabel", { label: address.label })}
          >
            <Pencil aria-hidden />
            {t("admin.settings.warehouse.edit")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => toggle.mutate()}
            disabled={toggle.isPending}
            aria-label={
              address.is_active
                ? t("admin.settings.warehouse.deactivateLabel", { label: address.label })
                : t("admin.settings.warehouse.activateLabel", { label: address.label })
            }
          >
            {toggle.isPending ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : (
              <Power aria-hidden />
            )}
            {address.is_active
              ? t("admin.settings.warehouse.deactivate")
              : t("admin.settings.warehouse.activate")}
          </Button>
        </div>
      ) : null}
    </li>
  );
}

function WarehouseAddressDialog({
  userId,
  address,
  customers,
  initialCustomerId,
  onClose,
}: {
  userId: string;
  address: WarehouseAddressRow | null;
  customers: readonly CustomerListRow[];
  initialCustomerId: string | null;
  onClose: () => void;
}) {
  const t = useT();
  const id = useId();
  const queryClient = useQueryClient();
  const [values, setValues] = useState<WarehouseAddressValues>(() =>
    address ? warehouseInputValues(address) : EMPTY_WAREHOUSE_ADDRESS,
  );
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(initialCustomerId);
  const previewCustomer = customers.find((c) => c.id === previewId) ?? null;
  const person: AddressPerson = previewCustomer
    ? { fullName: previewCustomer.full_name, customerCode: previewCustomer.customer_code }
    : { fullName: t("admin.settings.warehouse.sampleName"), customerCode: SAMPLE_CODE };

  const save = useMutation({
    mutationFn: (data: Parameters<typeof saveWarehouseAddress>[2]) =>
      saveWarehouseAddress(supabase, address?.id ?? null, data),
    onSuccess: async (saved) => {
      toast.success(t("admin.settings.warehouse.saved", { label: saved.label }));
      await queryClient.invalidateQueries({ queryKey: adminKeys.config(userId) });
      onClose();
    },
    onError: (e) => {
      setProblem(errorMessage(e));
      toast.error(`${t("admin.settings.warehouse.failed")} ${errorMessage(e)}`);
    },
  });

  const set = <F extends Field>(field: F, value: WarehouseAddressValues[F]) => {
    setValues((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setProblem(null);
    const parsed = warehouseAddressSchema.safeParse(values);
    if (!parsed.success) {
      const found = fieldErrorsOf<Field>(parsed.error);
      setErrors(found);
      const first = FIELDS.find((f) => found[f]);
      if (first) document.getElementById(`${id}-${first}`)?.focus();
      return;
    }
    save.mutate(parsed.data);
  };

  // The live preview, from what is typed now (empty fields simply drop out).
  const preview: WarehouseAddress = useMemo(
    () => ({
      id: address?.id ?? "new",
      label: values.label,
      service_type: SERVICE_TYPES.find((s) => s === values.serviceType) ?? "air",
      recipient_name_template: values.recipientTemplate,
      address_line1: values.line1,
      address_line2_template: values.line2Template,
      city: values.city,
      state: values.state,
      zip: values.zip,
      country: values.country,
      phone: values.phone,
    }),
    [address?.id, values],
  );
  const warnings = warehouseWarnings(values);
  const text = (
    field: Exclude<Field, "serviceType" | "active">,
    label: string,
    extra: object = {},
  ) => (
    <TextField
      idPrefix={id}
      field={field}
      label={label}
      value={values[field]}
      onChange={(v) => set(field, v)}
      error={errors[field]}
      autoComplete="off"
      {...extra}
    />
  );

  return (
    <Dialog open onOpenChange={(next) => !next && !save.isPending && onClose()}>
      <DialogContent className="max-h-[92vh] w-[calc(100%-2rem)] overflow-y-auto rounded-lg bg-card sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="font-heading text-primary">
            {address
              ? t("admin.settings.warehouse.editTitle", { label: address.label })
              : t("admin.settings.warehouse.addTitle")}
          </DialogTitle>
          <DialogDescription>
            {t("admin.settings.warehouse.dialogIntro", PLACEHOLDER_VARS)}
          </DialogDescription>
        </DialogHeader>
        <form noValidate onSubmit={submit} className="min-w-0 space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            {text("label", t("admin.settings.warehouse.label"), {
              hint: t("admin.settings.warehouse.labelHint"),
              maxLength: 100,
            })}
            <SelectField
              idPrefix={id}
              field="serviceType"
              label={t("admin.settings.warehouse.serviceType")}
              value={values.serviceType}
              onChange={(v) => {
                const type = SERVICE_TYPES.find((s) => s === v);
                if (type) set("serviceType", type);
              }}
              options={SERVICE_TYPES.map((s) => ({
                value: s,
                label: t(`portal.serviceTypes.${s}`),
              }))}
              error={errors.serviceType}
            />
            {text("recipientTemplate", t("admin.settings.warehouse.recipientTemplate"), {
              hint: t("admin.settings.warehouse.recipientHint", PLACEHOLDER_VARS),
              maxLength: 200,
              spellCheck: false,
            })}
            {text("line1", t("admin.settings.warehouse.line1"), { maxLength: 200 })}
            {text("line2Template", t("admin.settings.warehouse.line2Template"), {
              hint: t("admin.settings.warehouse.line2Hint", PLACEHOLDER_VARS),
              maxLength: 200,
              spellCheck: false,
            })}
            {text("city", t("admin.settings.warehouse.city"), { maxLength: 100 })}
            {text("state", t("admin.settings.warehouse.state"), { maxLength: 50 })}
            {text("zip", t("admin.settings.warehouse.zip"), {
              maxLength: 20,
              inputMode: "numeric",
            })}
            {text("country", t("admin.settings.warehouse.country"), { maxLength: 100 })}
            {text("phone", t("admin.settings.warehouse.phone"), {
              optional: true,
              maxLength: 50,
              type: "tel",
              inputMode: "tel",
            })}
          </div>
          <SwitchField
            idPrefix={id}
            field="active"
            label={t("admin.settings.warehouse.activeField")}
            checked={values.active === "true"}
            onChange={(on) => set("active", on ? "true" : "false")}
          />
          {warnings.length > 0 ? (
            <div
              className="space-y-1 rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-sm text-foreground"
              aria-live="polite"
            >
              {warnings.map((w) => (
                <p key={w} className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
                  {w}
                </p>
              ))}
            </div>
          ) : null}

          <div className="space-y-2 border-t pt-4">
            <p className="text-sm font-semibold text-foreground">
              {t("admin.settings.warehouse.preview")}
            </p>
            {customers.length > 0 ? (
              <div className="space-y-1.5 sm:max-w-md">
                <Label htmlFor={`${id}-previewCustomer`}>
                  {t("admin.settings.warehouse.previewCustomer")}
                </Label>
                <CustomerPicker
                  id={`${id}-previewCustomer`}
                  customers={customers}
                  value={previewId}
                  onChange={setPreviewId}
                />
              </div>
            ) : null}
            <PersonalPreview
              address={preview}
              person={person}
              heading={t("admin.settings.warehouse.previewFor", {
                name: person.fullName,
                code: person.customerCode,
              })}
            />
          </div>

          <Problem prefix={t("admin.settings.warehouse.failed")} message={problem} />
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={save.isPending}>
              {t("admin.settings.warehouse.cancel")}
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              {save.isPending
                ? t("admin.settings.warehouse.saving")
                : t("admin.settings.warehouse.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
