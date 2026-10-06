import type { ReactNode } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { KeyRound, Loader2, Save } from "lucide-react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { supabase } from "@/integrations/supabase/client";
import { ShellPageHeader } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { contactSchema, PHONE_PREFIX } from "@/lib/auth/schemas";
import { errorMessage } from "@/lib/errors";
import { t, useT } from "@/lib/i18n";
import { paths } from "@/lib/paths";
import { formatPhone } from "@/lib/phone";
import { customerQueryKey, type PortalCustomer } from "@/lib/portal/customer";
import { usePortalCustomer } from "@/lib/portal/use-portal-customer";

export const Route = createFileRoute("/portal/profiel")({
  head: () => ({ meta: [{ title: t("meta.pageTitle", { page: t("portal.profile.title") }) }] }),
  component: ProfilePage,
});

// Proper names, not UI copy: Suriname's ten districts, offered as suggestions.
const DISTRICTS = [
  "Brokopondo",
  "Commewijne",
  "Coronie",
  "Marowijne",
  "Nickerie",
  "Para",
  "Paramaribo",
  "Saramacca",
  "Sipaliwini",
  "Wanica",
];

type FormInput = z.input<typeof contactSchema>;
type FormOutput = z.output<typeof contactSchema>;

function formValues(customer: PortalCustomer): FormInput {
  return {
    phone: customer.phone ? formatPhone(customer.phone) : PHONE_PREFIX,
    address: customer.address ?? "",
    district: customer.district ?? "",
    contactPerson: customer.contact_person ?? "",
  };
}

function ProfilePage() {
  const t = useT();
  const { customer } = usePortalCustomer();
  const isBusiness = customer.account_type === "business";

  return (
    <>
      <ShellPageHeader title={t("portal.profile.title")} description={t("portal.profile.intro")} />
      <div className="grid items-start gap-6 lg:grid-cols-[1fr_1.2fr]">
        <section className="rounded-lg border bg-card p-6 shadow-sm">
          <h2 className="text-lg text-foreground">{t("portal.profile.accountSection")}</h2>
          <dl className="mt-4 divide-y text-sm">
            <Detail label={t("portal.profile.customerCode")}>
              <span className="font-heading font-bold text-primary tabular-nums">
                {customer.customer_code}
              </span>
            </Detail>
            <Detail label={t("portal.profile.name")}>{customer.full_name}</Detail>
            <Detail label={t("portal.profile.accountType")}>
              {t(isBusiness ? "auth.fields.business" : "auth.fields.personal")}
            </Detail>
            {isBusiness && customer.company_name ? (
              <Detail label={t("portal.profile.companyName")}>{customer.company_name}</Detail>
            ) : null}
            {customer.kkf_number ? (
              <Detail label={t("portal.profile.kkfNumber")}>
                <span className="tabular-nums">{customer.kkf_number}</span>
              </Detail>
            ) : null}
            {customer.email ? (
              <Detail label={t("portal.profile.email")}>
                <span className="break-all">{customer.email}</span>
              </Detail>
            ) : null}
          </dl>
          <p className="mt-4 text-xs leading-5 text-muted-foreground">
            {t("portal.profile.readOnlyHint")}
          </p>
        </section>

        <div className="space-y-6">
          <ContactForm customer={customer} isBusiness={isBusiness} />
          <section className="rounded-lg border bg-card p-6 shadow-sm">
            <h2 className="text-lg text-foreground">{t("portal.profile.passwordSection")}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t("portal.profile.passwordText")}</p>
            <Button asChild variant="outline" className="mt-4">
              <Link to={paths.setPassword}>
                <KeyRound aria-hidden />
                {t("portal.profile.changePassword")}
              </Link>
            </Button>
          </section>
        </div>
      </div>
    </>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[8.5rem_1fr] gap-3 py-2.5 first:pt-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-foreground">{children}</dd>
    </div>
  );
}

function ContactForm({ customer, isBusiness }: { customer: PortalCustomer; isBusiness: boolean }) {
  const t = useT();
  const queryClient = useQueryClient();
  const { auth } = usePortalCustomer();
  const form = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(contactSchema),
    defaultValues: formValues(customer),
  });

  const save = useMutation({
    mutationFn: async (values: FormOutput) => {
      // update_my_contact (SPEC §35.5): an empty string clears a field; the
      // contact person only applies to business accounts.
      const { data, error } = await supabase.rpc("update_my_contact", {
        _phone: values.phone,
        _address: values.address,
        _district: values.district,
        ...(isBusiness ? { _contact_person: values.contactPerson } : {}),
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (row) => {
      const updated: PortalCustomer = { ...customer, ...pickContact(row) };
      queryClient.setQueryData(customerQueryKey(auth.userId), updated);
      form.reset(formValues(updated));
      toast.success(t("toast.saved"));
    },
    onError: (error) => {
      toast.error(errorMessage(error));
    },
  });

  return (
    <section className="rounded-lg border bg-card p-6 shadow-sm">
      <h2 className="text-lg text-foreground">{t("portal.profile.contactSection")}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{t("portal.profile.contactIntro")}</p>
      <Form {...form}>
        <form
          onSubmit={form.handleSubmit((values) => save.mutateAsync(values).catch(() => undefined))}
          noValidate
          className="mt-5 space-y-4"
        >
          <FormField
            control={form.control}
            name="phone"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("portal.profile.phone")}</FormLabel>
                <FormControl>
                  <Input
                    type="tel"
                    autoComplete="tel"
                    inputMode="tel"
                    className="h-10"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="address"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("portal.profile.address")}</FormLabel>
                <FormControl>
                  <Input autoComplete="street-address" className="h-10" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="district"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("portal.profile.district")}</FormLabel>
                <FormControl>
                  <Input
                    list="district-options"
                    autoComplete="address-level1"
                    className="h-10"
                    {...field}
                  />
                </FormControl>
                <datalist id="district-options">
                  {DISTRICTS.map((district) => (
                    <option key={district} value={district} />
                  ))}
                </datalist>
                <FormMessage />
              </FormItem>
            )}
          />
          {isBusiness ? (
            <FormField
              control={form.control}
              name="contactPerson"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("portal.profile.contactPerson")}</FormLabel>
                  <FormControl>
                    <Input autoComplete="name" className="h-10" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          ) : null}
          <Button type="submit" disabled={save.isPending || !form.formState.isDirty}>
            {save.isPending ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : (
              <Save aria-hidden />
            )}
            {save.isPending ? t("portal.profile.saving") : t("portal.profile.save")}
          </Button>
        </form>
      </Form>
    </section>
  );
}

function pickContact(
  row: Pick<PortalCustomer, "phone" | "address" | "district" | "contact_person">,
) {
  return {
    phone: row.phone,
    address: row.address,
    district: row.district,
    contact_person: row.contact_person,
  };
}
