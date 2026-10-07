import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  AlertTriangle,
  ArrowLeft,
  Ban,
  ClipboardList,
  Info,
  Loader2,
  MapPin,
  PackagePlus,
  PackageSearch,
} from "lucide-react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { ShellPageHeader } from "@/components/layout/AppShell";
import { NewOrderDocuments } from "@/components/portal/NewOrderDocuments";
import { NewOrderUploads } from "@/components/portal/NewOrderUploads";
import { OrderFieldsInputs } from "@/components/portal/OrderFieldsInputs";
import { OrderTypeChooser } from "@/components/portal/OrderTypeChooser";
import { LoadError, Section } from "@/components/portal/Section";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Form } from "@/components/ui/form";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage, toAppError, type AppError } from "@/lib/errors";
import { t, useT } from "@/lib/i18n";
import { paths } from "@/lib/paths";
import type { PortalCustomer } from "@/lib/portal/customer";
import {
  defaultDocumentKind,
  type QueuedDocument,
  type UploadState,
} from "@/lib/portal/document-queue";
import { DocumentUploadError, uploadOrderDocument } from "@/lib/portal/documents";
import type { OrderFieldsInput, OrderFieldsOutput } from "@/lib/portal/order-fields";
import {
  lockedByRoot,
  newOrderDefaults,
  newOrderPageSearchSchema,
  orderRegistrationFieldsSchema,
  type NewOrderPageSearch,
  type RootOrder,
} from "@/lib/portal/order-schema";
import {
  enabledServiceTypesQueryOptions,
  orderGroupRoot,
  orderQueryOptions,
  portalKeys,
  resolveStatus,
  statusesQueryOptions,
  type OrderType,
  type ServiceType,
} from "@/lib/portal/orders";
import { usePortalCustomer } from "@/lib/portal/use-portal-customer";
import { submitOrderRegistration } from "@/lib/server-fns/orders.functions";

/**
 * /portal/orders/nieuw "Order aanmelden" (SPEC §9, §35.7, §35.14).
 *
 * Step 1 chooses a personal or business order (?type=…); step 2 is the form.
 * `?parent=<root order id>` registers an extra package of that purchase
 * (part A's contract): no type step, purchase details taken over.
 * The order is created by registerOrderFn (user-scoped client, RLS and
 * triggers); optional documents are then uploaded by the browser, one by
 * one, straight to the private bucket.
 */
export const Route = createFileRoute("/portal/orders/nieuw")({
  validateSearch: (search: Record<string, unknown>): NewOrderPageSearch =>
    newOrderPageSearchSchema.parse(search),
  head: () => ({ meta: [{ title: t("meta.pageTitle", { page: t("portal.newOrder.title") }) }] }),
  component: NewOrderPage,
});

function NewOrderPage() {
  const t = useT();
  const { auth, customer } = usePortalCustomer();
  const { parent, type } = Route.useSearch();
  const serviceTypes = useQuery(enabledServiceTypesQueryOptions(auth.userId));
  const statuses = useQuery({ ...statusesQueryOptions(auth.userId), enabled: Boolean(parent) });
  const parentOrder = useQuery({
    ...orderQueryOptions(auth.userId, customer.id, parent ?? ""),
    enabled: Boolean(parent),
  });
  // Part A passes the root; a link to an extra package is followed to its root.
  const rootId = parentOrder.data ? orderGroupRoot(parentOrder.data) : null;
  const viaChild = Boolean(rootId && rootId !== parent);
  const rootOrder = useQuery({
    ...orderQueryOptions(auth.userId, customer.id, rootId ?? ""),
    enabled: viaChild,
  });
  const root = viaChild ? rootOrder.data : parentOrder.data;

  const sibling = Boolean(parent);
  const header = sibling ? (
    <>
      {root ? (
        <Link
          to="/portal/orders/$id"
          params={{ id: root.id }}
          className="mb-4 inline-flex items-center gap-1.5 rounded-sm text-sm font-semibold text-primary underline-offset-4 hover:underline"
        >
          <ArrowLeft className="size-4" aria-hidden />
          {t("portal.newOrder.sibling.back", { reference: root.reference })}
        </Link>
      ) : null}
      <ShellPageHeader
        title={t("portal.newOrder.sibling.title")}
        description={
          root ? t("portal.newOrder.sibling.intro", { reference: root.reference }) : undefined
        }
      />
    </>
  ) : (
    <ShellPageHeader
      title={t("portal.newOrder.title")}
      description={
        <div className="space-y-2">
          <p>{t("portal.newOrder.intro")}</p>
          <p className="flex items-start gap-1.5">
            <MapPin className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
            <span>
              {t("portal.newOrder.addressHint", { code: customer.customer_code })}{" "}
              <Link
                to={paths.portal}
                className="font-semibold text-primary underline underline-offset-4"
              >
                {t("portal.newOrder.viewAddress")}
              </Link>
            </span>
          </p>
        </div>
      }
    />
  );

  const failed = [serviceTypes, statuses, parentOrder, rootOrder].find((q) => q.isError);
  if (failed) {
    return (
      <Shell header={header}>
        <div className="rounded-lg border bg-card p-6 shadow-sm">
          <LoadError
            title={
              failed === serviceTypes
                ? t("portal.newOrder.loadFailed")
                : t("portal.newOrder.sibling.loadFailed")
            }
            error={failed.error}
            onRetry={() => {
              for (const q of [serviceTypes, statuses, parentOrder, rootOrder]) {
                if (q.isError) void q.refetch();
              }
            }}
          />
        </div>
      </Shell>
    );
  }

  const pending =
    serviceTypes.isPending ||
    (sibling && (statuses.isPending || parentOrder.isPending || (viaChild && rootOrder.isPending)));
  if (pending) {
    return (
      <Shell header={header}>
        <div className="space-y-4" aria-busy="true">
          <p className="sr-only">{t("common.loading")}</p>
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </Shell>
    );
  }

  if (sibling && !root) {
    return (
      <Shell header={header}>
        <Notice icon={PackageSearch} title={t("portal.newOrder.sibling.notFoundTitle")}>
          <p>{t("portal.newOrder.sibling.notFoundText")}</p>
          <NewOrderLink />
        </Notice>
      </Shell>
    );
  }

  if (root && statuses.data && resolveStatus(root.status, statuses.data).stage === "cancelled") {
    return (
      <Shell header={header}>
        <Notice icon={Ban} title={t("portal.newOrder.sibling.cancelledTitle")}>
          <p>{t("portal.newOrder.sibling.cancelledText")}</p>
          <NewOrderLink />
        </Notice>
      </Shell>
    );
  }

  const enabled = serviceTypes.data ?? [];
  if (enabled.length === 0) {
    return (
      <Shell header={header}>
        <Notice icon={Info} title={t("portal.newOrder.title")}>
          <p>{t("portal.newOrder.noService")}</p>
        </Notice>
      </Shell>
    );
  }

  return (
    <Shell header={header}>
      <NewOrderFlow
        // A fresh form per purchase when following another "Extra pakket" link.
        key={root?.id ?? "new"}
        userId={auth.userId}
        customer={customer}
        serviceTypes={enabled}
        root={root ?? null}
        type={type}
      />
    </Shell>
  );
}

function Shell({ header, children }: { header: ReactNode; children: ReactNode }) {
  return (
    <div className="w-full max-w-3xl">
      {header}
      {children}
    </div>
  );
}

function Notice({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Info;
  title: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby="new-order-notice-title"
      className="rounded-lg border bg-card p-6 shadow-sm"
    >
      <h2 id="new-order-notice-title" className="flex items-center gap-2 text-lg text-primary">
        <Icon className="size-5 shrink-0" aria-hidden />
        {title}
      </h2>
      <div className="mt-2 space-y-4 text-sm leading-6 text-muted-foreground">{children}</div>
    </section>
  );
}

function NewOrderLink() {
  const t = useT();
  return (
    <Button asChild>
      <Link to="/portal/orders/nieuw" search={{}}>
        <PackagePlus aria-hidden />
        {t("portal.newOrder.sibling.newOrder")}
      </Link>
    </Button>
  );
}

// ---------------------------------------------------------------------------
// The flow: type choice → form → (documents) → order page
// ---------------------------------------------------------------------------

type CreatedOrder = { id: string; reference: string };

function NewOrderFlow({
  userId,
  customer,
  serviceTypes,
  root,
  type,
}: {
  userId: string;
  customer: PortalCustomer;
  serviceTypes: readonly ServiceType[];
  root: (RootOrder & { reference: string }) | null;
  type: OrderType | undefined;
}) {
  const t = useT();
  const id = useId();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const form = useForm<OrderFieldsInput, unknown, OrderFieldsOutput>({
    resolver: zodResolver(orderRegistrationFieldsSchema),
    defaultValues: newOrderDefaults({ orderType: type, serviceTypes, root }),
  });
  const orderType = form.watch("orderType");
  const [accepted, setAccepted] = useState(false);
  const [acceptError, setAcceptError] = useState(false);
  const acceptRef = useRef<HTMLButtonElement>(null);
  const [queue, setQueue] = useState<QueuedDocument[]>([]);
  const [submitError, setSubmitError] = useState<AppError | null>(null);
  const submitErrorRef = useRef<HTMLDivElement>(null);
  const [created, setCreated] = useState<CreatedOrder | null>(null);
  const [uploads, setUploads] = useState<UploadState[]>([]);

  // Step 1's choice lives in the URL; the form follows it and keeps the rest.
  useEffect(() => {
    if (!root && type && form.getValues("orderType") !== type) {
      form.setValue("orderType", type, { shouldDirty: true });
    }
  }, [form, root, type]);

  // The submit button was disabled while sending, which drops keyboard focus:
  // move it to the message, centred so a toast does not cover it.
  useEffect(() => {
    if (!submitError) return;
    submitErrorRef.current?.focus({ preventScroll: true });
    submitErrorRef.current?.scrollIntoView({ block: "center" });
  }, [submitError]);

  const toOrder = (order: CreatedOrder) =>
    navigate({ to: "/portal/orders/$id", params: { id: order.id }, replace: true });

  const setUpload = (index: number, state: UploadState) =>
    setUploads((prev) => prev.map((s, i) => (i === index ? state : s)));

  /** Uploads the given files one by one; the order exists whatever happens here. */
  async function uploadDocuments(order: CreatedOrder, indices: readonly number[]) {
    let failed = 0;
    for (const index of indices) {
      const doc = queue[index];
      if (!doc) continue;
      setUpload(index, { status: "uploading" });
      try {
        await uploadOrderDocument({
          customerId: customer.id,
          orderId: order.id,
          file: doc.file,
          kind: doc.kind,
        });
        setUpload(index, { status: "done" });
      } catch (error) {
        failed += 1;
        setUpload(index, {
          status: "failed",
          error:
            error instanceof DocumentUploadError
              ? t(`portal.upload.errors.${error.reason}`)
              : errorMessage(error),
        });
      }
    }
    void queryClient.invalidateQueries({ queryKey: portalKeys.orderDocuments(userId, order.id) });
    if (failed === 0) {
      toast.success(t("portal.newOrder.upload.success"));
      await toOrder(order);
    } else {
      toast.error(t("portal.newOrder.upload.failedTitle"));
    }
  }

  const retryUploads = () => {
    if (!created) return;
    const failedIndices = uploads.flatMap((s, i) => (s.status === "failed" ? [i] : []));
    setUploads((prev) => prev.map((s) => (s.status === "failed" ? { status: "waiting" } : s)));
    void uploadDocuments(created, failedIndices);
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    if (!accepted) setAcceptError(true);
    void form.handleSubmit(async () => {
      if (!accepted) {
        acceptRef.current?.focus();
        return;
      }
      setSubmitError(null);
      let order: CreatedOrder;
      try {
        order = await submitOrderRegistration({
          // The raw form values: the server validates them with the same schema.
          fields: form.getValues(),
          prohibitedGoodsAccepted: true,
          parentOrderId: root?.id ?? null,
        });
      } catch (error) {
        const app = toAppError(error);
        setSubmitError(app);
        toast.error(app.message);
        return;
      }
      toast.success(t("toast.orderRegistered"));
      // The list, the dashboard cards, the activity feed and the group of the root order.
      void queryClient.invalidateQueries({ queryKey: portalKeys.orders(userId) });
      if (queue.length === 0) {
        await toOrder(order);
        return;
      }
      setCreated(order);
      setUploads(queue.map(() => ({ status: "waiting" })));
      await uploadDocuments(
        order,
        queue.map((_, i) => i),
      );
    })(event);
  };

  if (created) {
    return (
      <NewOrderUploads order={created} queue={queue} states={uploads} onRetry={retryUploads} />
    );
  }

  if (!root && !type) return <OrderTypeChooser headingId={`${id}-type-step`} />;

  const submitting = form.formState.isSubmitting;
  return (
    <Form {...form}>
      <form noValidate onSubmit={onSubmit} className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-lg border bg-card px-5 py-4 shadow-sm">
          <p className="text-sm">
            <span className="text-muted-foreground">{t("portal.newOrder.chosenType")}: </span>
            <span className="font-heading font-bold text-primary">
              {orderType === "b2b"
                ? t("portal.newOrder.typeStep.b2bTitle")
                : t("portal.newOrder.typeStep.personalTitle")}
            </span>
            {root ? (
              <span className="text-muted-foreground">
                {" "}
                ({t("portal.newOrder.typeFromRoot", { reference: root.reference })})
              </span>
            ) : null}
          </p>
          {root ? null : (
            <Link
              to="/portal/orders/nieuw"
              search={{}}
              aria-label={t("portal.newOrder.changeTypeLabel")}
              className="inline-flex min-h-11 items-center rounded-sm text-sm font-semibold text-primary underline underline-offset-4 sm:min-h-0"
            >
              {t("portal.newOrder.changeType")}
            </Link>
          )}
        </div>

        <Section
          title={t("portal.newOrder.formTitle")}
          icon={ClipboardList}
          id={`${id}-fields`}
          description={t("portal.newOrder.requiredNote")}
        >
          <OrderFieldsInputs
            form={form}
            serviceTypes={serviceTypes}
            idPrefix={id}
            variant="register"
            locked={root ? lockedByRoot(root) : undefined}
            lockedHint={
              root
                ? t("portal.orderForm.fields.lockedHint", { reference: root.reference })
                : undefined
            }
          />
        </Section>

        <NewOrderDocuments
          queue={queue}
          onChange={setQueue}
          defaultKind={defaultDocumentKind(orderType)}
          isB2b={orderType === "b2b"}
          disabled={submitting}
        />

        <div className="space-y-5 rounded-lg border bg-card p-5 shadow-sm sm:p-6">
          <div className="space-y-2">
            <div className="flex items-start gap-3">
              <Checkbox
                ref={acceptRef}
                id={`${id}-prohibited`}
                checked={accepted}
                onCheckedChange={(checked) => {
                  setAccepted(checked === true);
                  if (checked === true) setAcceptError(false);
                }}
                aria-required
                aria-invalid={acceptError || undefined}
                aria-describedby={acceptError ? `${id}-prohibited-error` : undefined}
                className="mt-0.5 size-5"
              />
              <Label htmlFor={`${id}-prohibited`} className="text-sm font-normal leading-6">
                {t("portal.newOrder.prohibited.before")}{" "}
                <a
                  href="/verboden-goederen"
                  target="_blank"
                  rel="noopener"
                  className="font-semibold text-primary underline underline-offset-4"
                >
                  {t("portal.newOrder.prohibited.link")}
                  <span className="sr-only"> {t("portal.newOrder.prohibited.newTab")}</span>
                </a>
                {t("portal.newOrder.prohibited.after")}
              </Label>
            </div>
            {acceptError ? (
              <p
                id={`${id}-prohibited-error`}
                className="text-[0.8rem] font-medium text-destructive"
              >
                {t("portal.newOrder.prohibited.required")}
              </p>
            ) : null}
          </div>

          {submitError ? (
            <div
              ref={submitErrorRef}
              role="alert"
              tabIndex={-1}
              className="flex gap-3 rounded-md border border-destructive/40 bg-destructive-soft px-4 py-3 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
              <div className="min-w-0">
                <p className="font-semibold text-destructive">
                  {t("portal.newOrder.submitFailed")}
                </p>
                <p className="mt-1 text-foreground">{submitError.message}</p>
              </div>
            </div>
          ) : null}

          <div className="flex flex-col-reverse gap-3 border-t pt-5 sm:flex-row sm:justify-end">
            <Button asChild variant="outline" className="h-11 sm:h-10">
              {root ? (
                <Link to="/portal/orders/$id" params={{ id: root.id }}>
                  {t("portal.newOrder.cancel")}
                </Link>
              ) : (
                <Link to="/portal/orders">{t("portal.newOrder.cancel")}</Link>
              )}
            </Button>
            <Button type="submit" className="h-11 sm:h-10" disabled={submitting}>
              {submitting ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <PackagePlus aria-hidden />
              )}
              {submitting
                ? t("portal.newOrder.submitting")
                : root
                  ? t("portal.newOrder.submitSibling")
                  : t("portal.newOrder.submit")}
            </Button>
          </div>
        </div>
      </form>
    </Form>
  );
}
