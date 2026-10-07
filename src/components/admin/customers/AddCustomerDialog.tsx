import { useId, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2, UserPlus } from "lucide-react";
import { toast } from "sonner";

import {
  AccountTypeField,
  CustomerCodeField,
  TextField,
} from "@/components/admin/customers/CustomerFormFields";
import {
  fieldErrorsOf,
  focusFirstError,
  useFormValues,
} from "@/components/admin/customers/form-state";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import {
  addCustomer,
  addCustomerSchema,
  type AccountType,
  type CustomerSummary,
} from "@/lib/admin/customer-actions";
import { adminKeys } from "@/lib/admin/keys";
import { errorMessage } from "@/lib/errors";
import { useT } from "@/lib/i18n";

/** In the order the form shows them, for focusing the first problem. */
const FIELDS = [
  "companyName",
  "fullName",
  "phone",
  "email",
  "code",
  "address",
  "district",
  "contactPerson",
  "kkfNumber",
] as const;
type Field = (typeof FIELDS)[number];

/**
 * "Klant toevoegen" (SPEC §35.5): a customer WITHOUT an invitation or login,
 * e.g. someone staff register orders for. Name and phone are required;
 * e-mail and an existing GR code are optional. create_customer (staff, with
 * the staff member's own client) numbers the customer or takes the code.
 */
export function AddCustomerDialog({
  userId,
  open,
  onOpenChange,
  onCreated,
}: {
  userId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (customer: CustomerSummary) => void;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="max-h-[92vh] w-[calc(100%-2rem)] overflow-y-auto rounded-lg bg-card sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="font-heading text-primary">
            {t("admin.customers.addDialog.title")}
          </DialogTitle>
          <DialogDescription>{t("admin.customers.addDialog.intro")}</DialogDescription>
        </DialogHeader>
        {open ? (
          <AddCustomerForm
            userId={userId}
            onBusyChange={setBusy}
            onClose={() => onOpenChange(false)}
            onCreated={onCreated}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function AddCustomerForm({
  userId,
  onBusyChange,
  onClose,
  onCreated,
}: {
  userId: string;
  onBusyChange: (busy: boolean) => void;
  onClose: () => void;
  onCreated: (customer: CustomerSummary) => void;
}) {
  const t = useT();
  const id = useId();
  const queryClient = useQueryClient();
  const [accountType, setAccountType] = useState<AccountType>("personal");
  const { values, set, errors, setErrors } = useFormValues<Field>({
    fullName: "",
    phone: "+597 ",
    email: "",
    code: "",
    companyName: "",
    kkfNumber: "",
    contactPerson: "",
    address: "",
    district: "",
  });
  const [problem, setProblem] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (input: Parameters<typeof addCustomer>[1]) => addCustomer(supabase, input),
    onMutate: () => onBusyChange(true),
    onSettled: () => onBusyChange(false),
    onSuccess: async (customer) => {
      toast.success(
        t("admin.customers.addDialog.success", {
          code: customer.customer_code,
          name: customer.full_name,
        }),
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: adminKeys.customers(userId) }),
        queryClient.invalidateQueries({ queryKey: adminKeys.customerCounts(userId) }),
      ]);
      onClose();
      onCreated(customer);
    },
    onError: (e) => {
      setProblem(errorMessage(e));
      toast.error(errorMessage(e));
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setProblem(null);
    const parsed = addCustomerSchema.safeParse({ ...values, accountType });
    if (!parsed.success) {
      const found = fieldErrorsOf<Field>(parsed.error);
      setErrors(found);
      focusFirstError(id, FIELDS, found);
      return;
    }
    setErrors({});
    save.mutate(parsed.data);
  };

  const field = (name: Field) => ({
    idPrefix: id,
    field: name,
    value: values[name],
    onChange: (v: string) => set(name, v),
    error: errors[name],
  });

  return (
    <form noValidate onSubmit={submit} className="min-w-0 space-y-4">
      <p className="text-xs text-muted-foreground">{t("admin.customers.form.requiredNote")}</p>
      <AccountTypeField idPrefix={id} value={accountType} onChange={setAccountType} />
      {accountType === "business" ? (
        <TextField
          {...field("companyName")}
          label={t("admin.customers.fields.companyName")}
          maxLength={220}
          autoComplete="organization"
        />
      ) : null}
      <TextField
        {...field("fullName")}
        label={t("admin.customers.fields.fullName")}
        hint={t("admin.customers.form.nameHint")}
        maxLength={220}
        autoComplete="off"
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          {...field("phone")}
          label={t("admin.customers.fields.phone")}
          hint={t("admin.customers.form.phoneHint")}
          type="tel"
          inputMode="tel"
          maxLength={60}
          autoComplete="off"
        />
        <TextField
          {...field("email")}
          label={t("admin.customers.fields.email")}
          hint={t("admin.customers.form.emailHintAdd")}
          optional
          type="email"
          inputMode="email"
          maxLength={330}
          autoComplete="off"
        />
      </div>
      <CustomerCodeField
        idPrefix={id}
        userId={userId}
        value={values.code}
        onChange={(v) => set("code", v)}
        error={errors.code}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          {...field("address")}
          label={t("admin.customers.fields.address")}
          optional
          maxLength={520}
          autoComplete="off"
        />
        <TextField
          {...field("district")}
          label={t("admin.customers.fields.district")}
          optional
          maxLength={120}
          autoComplete="off"
        />
      </div>
      {accountType === "business" ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            {...field("contactPerson")}
            label={t("admin.customers.fields.contactPerson")}
            optional
            maxLength={220}
            autoComplete="off"
          />
          <TextField
            {...field("kkfNumber")}
            label={t("admin.customers.fields.kkfNumber")}
            optional
            maxLength={60}
            autoComplete="off"
          />
        </div>
      ) : null}

      {problem ? (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive-soft px-3 py-2 text-sm text-destructive"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            {t("admin.customers.addDialog.failed")} {problem}
          </span>
        </p>
      ) : null}

      <DialogFooter className="gap-2">
        <Button type="button" variant="outline" onClick={onClose} disabled={save.isPending}>
          {t("admin.customers.addDialog.cancel")}
        </Button>
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? (
            <Loader2 className="animate-spin" aria-hidden />
          ) : (
            <UserPlus aria-hidden />
          )}
          {save.isPending
            ? t("admin.customers.addDialog.submitting")
            : t("admin.customers.addDialog.submit")}
        </Button>
      </DialogFooter>
    </form>
  );
}
