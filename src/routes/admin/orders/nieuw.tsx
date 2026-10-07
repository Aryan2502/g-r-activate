import { useEffect, useId, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute, getRouteApi, useNavigate } from "@tanstack/react-router";
import { AlertTriangle, ArrowLeft, Loader2, PackagePlus, Scale, UserRound } from "lucide-react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Callout, FieldError } from "@/components/admin/Callout";
import { CustomerPicker } from "@/components/admin/CustomerPicker";
import { ShellPageHeader } from "@/components/layout/AppShell";
import { OrderFieldsInputs } from "@/components/portal/OrderFieldsInputs";
import { LoadError, Section } from "@/components/portal/Section";
import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Constants } from "@/integrations/supabase/types";
import { adminKeys } from "@/lib/admin/keys";
import { measuredWeightText } from "@/lib/admin/order-actions";
import {
  adminOrderQueryOptions,
  customersQueryOptions,
  type AdminOrderDetail,
  type PickerCustomer,
} from "@/lib/admin/orders";
import { errorMessage } from "@/lib/errors";
import { t, useT } from "@/lib/i18n";
import {
  orderFieldShape,
  orderFieldsSchema,
  type OrderFieldsInput,
  type OrderFieldsOutput,
} from "@/lib/portal/order-fields";
import { lockedByRoot, newOrderDefaults } from "@/lib/portal/order-schema";
import { emailOutcomeText, statusEmailSummary } from "@/lib/email/outcome";
import { submitCreateOrder } from "@/lib/server-fns/admin-orders.functions";

/**
 * /admin/orders/nieuw "Order aanmaken voor klant" (SPEC §35.7): staff create
 * an order for any customer, also one without a login, with the same order
 * fields as the portal (order-fields.ts). The database makes it a staff
 * order (created_by_role 'staff') in the initial status. With a measured
 * weight it is received straight away (a package that arrived unannounced).
 *
 * ?customer=<id> preselects the customer (from "Order aanmaken voor deze
 * klant" on the customer page, which the back link and "Annuleren" then
 * return to), ?tracking=… comes from the receiving search, ?parent=<order id>
 * adds an extra package to a purchase.
 */
const searchSchema = z.object({
  customer: z.string().uuid().optional().catch(undefined),
  parent: z.string().uuid().optional().catch(undefined),
  tracking: z.string().trim().max(100).optional().catch(undefined),
});
type NewOrderSearch = z.infer<typeof searchSchema>;

export const Route = createFileRoute("/admin/orders/nieuw")({
  validateSearch: (search: Record<string, unknown>): NewOrderSearch => searchSchema.parse(search),
  head: () => ({ meta: [{ title: t("meta.pageTitle", { page: t("admin.newOrder.title") }) }] }),
  component: NewStaffOrderPage,
});

const adminRoute = getRouteApi("/admin");
const SERVICE_TYPES = Constants.public.Enums.service_type;
/** The order fields in the order the form shows them. */
const FIELD_ORDER = Object.keys(orderFieldShape) as (keyof OrderFieldsInput)[];

function NewStaffOrderPage() {
  const t = useT();
  const { auth } = adminRoute.useRouteContext();
  const search = Route.useSearch();
  const customers = useQuery(customersQueryOptions(auth.userId));
  const parent = useQuery({
    ...adminOrderQueryOptions(auth.userId, search.parent ?? ""),
    enabled: Boolean(search.parent),
  });
  // A link to an extra package is followed to its root (no nested packages).
  const rootId = parent.data?.parent_order_id ?? null;
  const viaChild = useQuery({
    ...adminOrderQueryOptions(auth.userId, rootId ?? ""),
    enabled: Boolean(rootId),
  });
  const root = rootId ? viaChild.data : parent.data;
  const sibling = Boolean(search.parent);

  // "Order aanmaken voor deze klant" on a customer's page: back to that customer.
  const fromCustomer =
    !sibling && search.customer
      ? (customers.data ?? []).find((c) => c.id === search.customer)
      : undefined;
  const back = root ? (
    <Link
      to="/admin/orders/$id"
      params={{ id: root.id }}
      className="mb-4 inline-flex items-center gap-1.5 rounded-sm text-sm font-semibold text-primary underline-offset-4 hover:underline"
    >
      <ArrowLeft className="size-4" aria-hidden />
      {t("admin.newOrder.backToOrder", { reference: root.reference })}
    </Link>
  ) : fromCustomer ? (
    <Link
      to="/admin/klanten/$id"
      params={{ id: fromCustomer.id }}
      className="mb-4 inline-flex items-center gap-1.5 rounded-sm text-sm font-semibold text-primary underline-offset-4 hover:underline"
    >
      <ArrowLeft className="size-4" aria-hidden />
      {t("admin.newOrder.backToCustomer", { name: fromCustomer.full_name })}
    </Link>
  ) : (
    <Link
      to="/admin/orders"
      className="mb-4 inline-flex items-center gap-1.5 rounded-sm text-sm font-semibold text-primary underline-offset-4 hover:underline"
    >
      <ArrowLeft className="size-4" aria-hidden />
      {t("admin.newOrder.back")}
    </Link>
  );
  const header = (
    <>
      {back}
      <ShellPageHeader
        title={sibling ? t("admin.newOrder.siblingTitle") : t("admin.newOrder.title")}
        description={
          sibling
            ? root
              ? t("admin.newOrder.siblingIntro", { reference: root.reference })
              : undefined
            : t("admin.newOrder.intro")
        }
      />
    </>
  );

  const lookups = [customers, ...(sibling ? [parent] : []), ...(rootId ? [viaChild] : [])];
  const failed = lookups.find((q) => q.isError);
  if (failed) {
    return (
      <div className="mx-auto max-w-3xl">
        {header}
        <div className="rounded-lg border bg-card p-6 shadow-sm">
          <LoadError
            title={t("admin.newOrder.loadFailed")}
            error={failed.error}
            onRetry={() => lookups.forEach((q) => q.isError && void q.refetch())}
          />
        </div>
      </div>
    );
  }
  if (lookups.some((q) => q.isPending)) {
    return (
      <div className="mx-auto max-w-3xl" aria-busy="true">
        {header}
        <span className="sr-only">{t("common.loading")}</span>
        <div className="space-y-4">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-96 w-full" />
        </div>
      </div>
    );
  }
  if (sibling && !root) {
    return (
      <div className="mx-auto max-w-3xl">
        {header}
        <div className="rounded-lg border bg-card p-6 shadow-sm">
          <p className="text-sm text-foreground">{t("admin.newOrder.parentNotFound")}</p>
        </div>
      </div>
    );
  }

  // A link for a customer who cannot get new orders (disabled, or unknown):
  // say why the picker is empty instead of leaving it silently unselected.
  const linked = !sibling && search.customer ? search.customer : null;
  const unavailable =
    linked && (!fromCustomer || fromCustomer.status === "disabled") ? (
      <Callout
        tone="warning"
        icon={AlertTriangle}
        title={
          fromCustomer
            ? t("admin.newOrder.customerDisabled", {
                name: fromCustomer.full_name,
                code: fromCustomer.customer_code,
              })
            : t("admin.newOrder.customerNotFound")
        }
        className="mb-4"
      >
        {t("admin.newOrder.customerUnavailableHint")}
      </Callout>
    ) : null;

  return (
    <div className="mx-auto max-w-3xl">
      {header}
      {unavailable}
      <NewOrderForm
        userId={auth.userId}
        customers={customers.data ?? []}
        initialCustomer={root?.customer_id ?? search.customer ?? null}
        tracking={search.tracking ?? ""}
        root={root ?? null}
        backToCustomer={fromCustomer?.id ?? null}
      />
    </div>
  );
}

function NewOrderForm({
  userId,
  customers,
  initialCustomer,
  tracking,
  root,
  backToCustomer,
}: {
  userId: string;
  customers: readonly PickerCustomer[];
  initialCustomer: string | null;
  tracking: string;
  root: AdminOrderDetail | null;
  /** Opened from this customer's page: "Annuleren" goes back there. */
  backToCustomer: string | null;
}) {
  const t = useT();
  const id = useId();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [customerId, setCustomerId] = useState<string | null>(
    customers.some((c) => c.id === initialCustomer && c.status !== "disabled")
      ? initialCustomer
      : null,
  );
  const [weight, setWeight] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const form = useForm<OrderFieldsInput, unknown, OrderFieldsOutput>({
    resolver: zodResolver(orderFieldsSchema),
    // The customer picker comes first and is not a form field: focus by hand.
    shouldFocusError: false,
    defaultValues: {
      ...newOrderDefaults({ serviceTypes: SERVICE_TYPES, root }),
      trackingNumber: tracking,
    },
  });
  const locked = root ? { orderType: true, ...lockedByRoot(root) } : undefined;

  const customerError = customerId ? null : t("admin.newOrder.customerRequired");
  const weightCheck = measuredWeightText.safeParse(weight);
  const weightError = weightCheck.success ? null : t("admin.receive.weightInvalid");

  // After a failed submit the message is the place to look.
  useEffect(() => {
    if (submitError) document.getElementById(`${id}-submit-error`)?.focus();
  }, [submitError, id]);

  const submit = form.handleSubmit(
    async () => {
      if (customerError || weightError) {
        document.getElementById(customerError ? `${id}-customer` : `${id}-weight`)?.focus();
        return;
      }
      setSubmitError(null);
      try {
        const created = await submitCreateOrder({
          customerId: customerId ?? "",
          // The raw form values: the server validates them with the same schema.
          fields: form.getValues(),
          parentOrderId: root?.id ?? null,
          measuredWeightLbs: weight,
        });
        // Orders, and the customer's page and list (order counts) hang under these.
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: adminKeys.orders(userId) }),
          queryClient.invalidateQueries({ queryKey: adminKeys.customers(userId) }),
        ]);
        // What happened to the one e-mail: "order bevestigd", or the receipt's status e-mail.
        const description = [
          created.emailOutcome ? emailOutcomeText(created.emailOutcome) : null,
          statusEmailSummary(created.receiveEmailOutcomes),
        ]
          .filter(Boolean)
          .join(" ");
        if (created.receiveError) {
          toast.warning(
            t("admin.newOrder.receiveFailed", {
              reference: created.reference,
              message: created.receiveError.message,
            }),
            { description },
          );
        } else {
          toast.success(
            weight.trim()
              ? t("admin.newOrder.successReceived", { reference: created.reference })
              : t("admin.newOrder.success", { reference: created.reference }),
            { description },
          );
        }
        await navigate({ to: "/admin/orders/$id", params: { id: created.id } });
      } catch (error) {
        setSubmitError(errorMessage(error));
        toast.error(errorMessage(error));
      }
    },
    (fieldErrors) => {
      // The first problem on the page: the customer, else the first order field.
      if (customerError) {
        document.getElementById(`${id}-customer`)?.focus();
        return;
      }
      const first = FIELD_ORDER.find((name) => fieldErrors[name]);
      if (first) form.setFocus(first);
    },
  );

  const shownCustomerError = submitted ? customerError : null;
  const shownWeightError = submitted ? weightError : null;

  return (
    <Form {...form}>
      <form
        noValidate
        onSubmit={(e) => {
          setSubmitted(true);
          void submit(e);
        }}
        className="space-y-6"
      >
        <Section title={t("admin.newOrder.customer")} icon={UserRound} id="new-order-customer">
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-customer`}>{t("admin.newOrder.customer")}</Label>
            <CustomerPicker
              id={`${id}-customer`}
              customers={customers}
              value={customerId}
              onChange={setCustomerId}
              disabled={Boolean(root)}
              invalid={Boolean(shownCustomerError)}
              describedBy={shownCustomerError ? `${id}-customer-error` : undefined}
            />
            <FieldError id={`${id}-customer-error`} message={shownCustomerError} />
          </div>
        </Section>

        <Section
          title={t("portal.newOrder.formTitle")}
          icon={PackagePlus}
          id="new-order-fields"
          description={t("admin.newOrder.requiredNote")}
        >
          <OrderFieldsInputs
            form={form}
            serviceTypes={SERVICE_TYPES}
            idPrefix={id}
            audience="staff"
            locked={locked}
            lockedHint={
              root
                ? t("portal.orderForm.fields.lockedHint", { reference: root.reference })
                : undefined
            }
            trackingExtra={
              // The scale's weight next to the tracking number, never mistaken for
              // the customer's own figure below it (P4 review).
              <div className="space-y-1.5 rounded-md border border-primary/25 bg-cream/60 p-3 sm:max-w-[calc(50%-0.5rem)]">
                <Label htmlFor={`${id}-weight`} className="block leading-5">
                  <Scale className="mr-1.5 inline size-4 align-[-0.2em] text-primary" aria-hidden />
                  {t("admin.newOrder.weight")}{" "}
                  <span className="font-normal text-muted-foreground">
                    ({t("portal.orderForm.optional")})
                  </span>
                </Label>
                <Input
                  id={`${id}-weight`}
                  value={weight}
                  onChange={(e) => setWeight(e.target.value)}
                  inputMode="decimal"
                  autoComplete="off"
                  className="h-11 max-w-40 bg-card tabular-nums sm:h-10"
                  aria-invalid={shownWeightError ? true : undefined}
                  aria-describedby={`${id}-weight-hint${shownWeightError ? ` ${id}-weight-error` : ""}`}
                />
                <p id={`${id}-weight-hint`} className="text-xs leading-5 text-muted-foreground">
                  {t("admin.newOrder.weightHint")}
                </p>
                <FieldError id={`${id}-weight-error`} message={shownWeightError} />
              </div>
            }
          />
        </Section>

        {submitError ? (
          <p
            id={`${id}-submit-error`}
            tabIndex={-1}
            role="alert"
            className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive-soft px-3 py-2.5 text-sm text-destructive outline-none"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              {t("admin.newOrder.failed")} {submitError}
            </span>
          </p>
        ) : null}

        <div className="flex flex-col-reverse gap-3 border-t pt-5 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" asChild>
            {root ? (
              <Link to="/admin/orders/$id" params={{ id: root.id }}>
                {t("portal.newOrder.cancel")}
              </Link>
            ) : backToCustomer ? (
              <Link to="/admin/klanten/$id" params={{ id: backToCustomer }}>
                {t("portal.newOrder.cancel")}
              </Link>
            ) : (
              <Link to="/admin/orders">{t("portal.newOrder.cancel")}</Link>
            )}
          </Button>
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : (
              <PackagePlus aria-hidden />
            )}
            {form.formState.isSubmitting
              ? t("admin.newOrder.submitting")
              : t("admin.newOrder.submit")}
          </Button>
        </div>
      </form>
    </Form>
  );
}
