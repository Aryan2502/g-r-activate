import { useId, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Info, Loader2, Save } from "lucide-react";
import { toast } from "sonner";

import { AccountTypeField, TextField } from "@/components/admin/customers/CustomerFormFields";
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
  customerContactSchema,
  updateCustomerContact,
  type AccountType,
} from "@/lib/admin/customer-actions";
import type { CustomerRow } from "@/lib/admin/customers";
import { adminKeys } from "@/lib/admin/keys";
import { errorMessage } from "@/lib/errors";
import { useT } from "@/lib/i18n";

/** In the order the form shows them, for focusing the first problem. */
const FIELDS = [
  "companyName",
  "fullName",
  "phone",
  "email",
  "address",
  "district",
  "contactPerson",
  "kkfNumber",
] as const;
type Field = (typeof FIELDS)[number];

/**
 * "Gegevens wijzigen" (SPEC §13, §35.5) with the staff member's own client.
 * customers_guard decides who may change what: staff edit the contact
 * details, only an admin changes the e-mail address (staff see it
 * read-only). Changing the address revokes an open invitation (the link was
 * for the old one); for a customer with a login it changes the contact
 * address only, not the login.
 */
export function CustomerContactDialog({
  userId,
  isAdmin,
  customer,
  hasOpenInvitation,
  open,
  onOpenChange,
}: {
  userId: string;
  isAdmin: boolean;
  customer: CustomerRow;
  hasOpenInvitation: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="max-h-[92vh] w-[calc(100%-2rem)] overflow-y-auto rounded-lg bg-card sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="font-heading text-primary">
            {t("admin.customers.contact.title", { name: customer.full_name })}
          </DialogTitle>
          <DialogDescription>{t("admin.customers.contact.intro")}</DialogDescription>
        </DialogHeader>
        {open ? (
          <ContactForm
            userId={userId}
            isAdmin={isAdmin}
            customer={customer}
            hasOpenInvitation={hasOpenInvitation}
            onBusyChange={setBusy}
            onClose={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ContactForm({
  userId,
  isAdmin,
  customer,
  hasOpenInvitation,
  onBusyChange,
  onClose,
}: {
  userId: string;
  isAdmin: boolean;
  customer: CustomerRow;
  hasOpenInvitation: boolean;
  onBusyChange: (busy: boolean) => void;
  onClose: () => void;
}) {
  const t = useT();
  const id = useId();
  const queryClient = useQueryClient();
  const [accountType, setAccountType] = useState<AccountType>(customer.account_type);
  const { values, set, errors, setErrors } = useFormValues<Field>({
    companyName: customer.company_name ?? "",
    fullName: customer.full_name,
    phone: customer.phone ?? "",
    email: customer.email ?? "",
    address: customer.address ?? "",
    district: customer.district ?? "",
    contactPerson: customer.contact_person ?? "",
    kkfNumber: customer.kkf_number ?? "",
  });
  const [problem, setProblem] = useState<string | null>(null);
  const emailChanged = values.email.trim().toLowerCase() !== (customer.email ?? "");

  const save = useMutation({
    mutationFn: (input: Parameters<typeof updateCustomerContact>[2]) =>
      updateCustomerContact(supabase, customer.id, input, {
        includeEmail: isAdmin,
        current: customer,
      }),
    onMutate: () => onBusyChange(true),
    onSettled: () => onBusyChange(false),
    onSuccess: async (saved) => {
      toast.success(t("admin.customers.contact.saved", { name: saved.full_name }));
      // Orders and shipments embed the customer, so refresh those too.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: adminKeys.customers(userId) }),
        queryClient.invalidateQueries({ queryKey: adminKeys.orders(userId) }),
      ]);
      onClose();
    },
    onError: (e) => {
      setProblem(errorMessage(e));
      toast.error(errorMessage(e));
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setProblem(null);
    const parsed = customerContactSchema.safeParse({
      ...values,
      // Staff cannot change the address: keep the record's own value.
      email: isAdmin ? values.email : (customer.email ?? ""),
      accountType,
    });
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
      <AccountTypeField idPrefix={id} value={accountType} onChange={setAccountType} />
      {accountType === "business" ? (
        <TextField
          {...field("companyName")}
          label={t("admin.customers.fields.companyName")}
          maxLength={220}
          autoComplete="off"
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
          optional
          type="tel"
          inputMode="tel"
          maxLength={60}
          autoComplete="off"
        />
        <TextField
          {...field("email")}
          label={t("admin.customers.fields.email")}
          optional
          type="email"
          inputMode="email"
          maxLength={330}
          autoComplete="off"
          readOnly={!isAdmin}
          hint={isAdmin ? undefined : t("admin.customers.contact.emailAdminOnly")}
        />
      </div>
      {isAdmin && emailChanged && (customer.user_id || hasOpenInvitation) ? (
        <p className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-sm text-foreground">
          <Info className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          <span>
            {customer.user_id
              ? t("admin.customers.contact.emailLoginNote", { email: customer.email ?? "" })
              : t("admin.customers.contact.emailInvitationNote")}
          </span>
        </p>
      ) : null}
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
            {t("admin.customers.contact.failed")} {problem}
          </span>
        </p>
      ) : null}

      <DialogFooter className="gap-2">
        <Button type="button" variant="outline" onClick={onClose} disabled={save.isPending}>
          {t("admin.customers.contact.cancel")}
        </Button>
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <Save aria-hidden />}
          {save.isPending ? t("admin.customers.contact.saving") : t("admin.customers.contact.save")}
        </Button>
      </DialogFooter>
    </form>
  );
}
