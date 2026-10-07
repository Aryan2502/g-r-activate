import { useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute, getRouteApi, useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft,
  Ban,
  CircleCheck,
  ClipboardList,
  KeyRound,
  Pencil,
  PackagePlus,
  RefreshCcw,
  Send,
  UserRound,
  UserX,
} from "lucide-react";
import { z } from "zod";

import { Callout } from "@/components/admin/Callout";
import {
  ChangeCodeDialog,
  DisableCustomerDialog,
  RecoveryLinkDialog,
} from "@/components/admin/customers/CustomerActionDialogs";
import {
  AccountTypeBadge,
  CustomerStatusBadge,
  NoLoginBadge,
} from "@/components/admin/customers/CustomerBadges";
import { CustomerContactDialog } from "@/components/admin/customers/CustomerContactDialog";
import { CustomerInvitationPanel } from "@/components/admin/customers/CustomerInvitationPanel";
import { CustomerNotes } from "@/components/admin/customers/CustomerNotes";
import {
  CustomerDocumentsSection,
  CustomerInvoicesSection,
  CustomerOrdersSection,
  CustomerShipmentsSection,
} from "@/components/admin/customers/CustomerRecords";
import { CustomerTimeline } from "@/components/admin/customers/CustomerTimeline";
import { InviteCustomerDialog } from "@/components/admin/customers/InviteCustomerDialog";
import { DetailItem, DetailList, LoadError, Muted, Section } from "@/components/portal/Section";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { CustomerSummary } from "@/lib/admin/customer-actions";
import {
  currentInvitation,
  customerInvitationsQueryOptions,
  customerInvoicesQueryOptions,
  customerOrdersQueryOptions,
  customerQueryOptions,
  type CustomerRow,
} from "@/lib/admin/customers";
import { invitationState } from "@/lib/admin/invitations";
import { peopleQueryOptions, personName } from "@/lib/admin/orders";
import { adminStatusesQueryOptions } from "@/lib/admin/statuses";
import { formatDate, formatDateTime } from "@/lib/format";
import { t, useT } from "@/lib/i18n";
import { formatPhone, telHref } from "@/lib/phone";

/**
 * /admin/klanten/$id (SPEC §13, §35.5, §35.6): one customer's complete
 * profile and history. Contact details ("Gegevens wijzigen"; the e-mail only
 * by an admin), GR code ("Code wijzigen", admin, with a reason), status
 * ("Deactiveren"/"Activeren", admin, with a reason; the login is banned),
 * login yes/no, the invitation (resend, revoke, share), orders, shipments,
 * invoices and payments, documents, internal notes and a readable timeline,
 * plus "Order aanmaken voor deze klant" and "Wachtwoord-resetlink maken".
 *
 * ?codeChange=GR00017 opens "Code wijzigen" prefilled (from an invitation
 * conflict).
 */
const searchSchema = z.object({
  codeChange: z.string().trim().max(20).optional().catch(undefined),
});

export const Route = createFileRoute("/admin/klanten/$id")({
  validateSearch: (search: Record<string, unknown>) => searchSchema.parse(search),
  head: () => ({
    meta: [{ title: t("meta.pageTitle", { page: t("admin.customers.detail.heading") }) }],
  }),
  component: CustomerPage,
});

const adminRoute = getRouteApi("/admin");

function CustomerPage() {
  const t = useT();
  const { id } = Route.useParams();
  const { auth } = adminRoute.useRouteContext();
  const customer = useQuery(customerQueryOptions(auth.userId, id));

  const back = (
    <Link
      to="/admin/klanten"
      className="mb-4 inline-flex items-center gap-1.5 rounded-sm text-sm font-semibold text-primary underline-offset-4 hover:underline"
    >
      <ArrowLeft className="size-4" aria-hidden />
      {t("admin.customers.detail.back")}
    </Link>
  );

  if (customer.isError) {
    return (
      <>
        {back}
        <h1 className="sr-only">{t("admin.customers.detail.heading")}</h1>
        <div className="rounded-lg border bg-card p-6 shadow-sm">
          <LoadError
            title={t("admin.customers.detail.loadFailed")}
            error={customer.error}
            onRetry={() => void customer.refetch()}
          />
        </div>
      </>
    );
  }
  if (customer.isPending) {
    return (
      <>
        {back}
        <div className="space-y-4" aria-busy="true">
          <h1 className="sr-only">{t("common.loading")}</h1>
          <Skeleton className="h-9 w-2/3 max-w-sm" />
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      </>
    );
  }
  if (!customer.data) {
    return (
      <>
        {back}
        <div className="rounded-lg border bg-card p-6 shadow-sm">
          <h1 className="flex items-center gap-2 text-xl text-primary">
            <UserX className="size-5" aria-hidden />
            {t("admin.customers.notFoundTitle")}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">{t("admin.customers.notFoundText")}</p>
        </div>
      </>
    );
  }
  return (
    <>
      {back}
      <CustomerView
        key={customer.data.id}
        userId={auth.userId}
        isAdmin={auth.role === "admin"}
        customer={customer.data}
      />
    </>
  );
}

type DialogName = "contact" | "invite" | "code" | "disable" | "recovery" | null;

function summaryOf(c: CustomerRow): CustomerSummary {
  return {
    id: c.id,
    customer_code: c.customer_code,
    full_name: c.full_name,
    company_name: c.company_name,
    account_type: c.account_type,
    status: c.status,
    user_id: c.user_id,
    email: c.email,
    phone: c.phone,
  };
}

function CustomerView({
  userId,
  isAdmin,
  customer,
}: {
  userId: string;
  isAdmin: boolean;
  customer: CustomerRow;
}) {
  const t = useT();
  const navigate = useNavigate({ from: Route.fullPath });
  const search = Route.useSearch();
  const [dialog, setDialog] = useState<DialogName>(null);
  const orders = useQuery(customerOrdersQueryOptions(userId, customer.id));
  const statuses = useQuery(adminStatusesQueryOptions(userId));
  const invitations = useQuery(customerInvitationsQueryOptions(userId, customer.id));
  const invitation = invitations.data ? currentInvitation(invitations.data) : null;
  const pendingInvitation =
    invitation !== null && ["open", "expired"].includes(invitationState(invitation));
  const disabled = customer.status === "disabled";
  // Orders or issued invoices freeze the code (private.customer_has_activity);
  // change_customer_code checks it again.
  const invoices = useQuery(customerInvoicesQueryOptions(userId, customer.id));
  const codeLocked =
    (orders.data?.length ?? 0) > 0 ||
    (invoices.data?.invoices ?? []).some((i) => i.status !== "draft");
  const people = useQuery({
    ...peopleQueryOptions(userId, customer.disabled_by ? [customer.disabled_by] : []),
    enabled: Boolean(customer.disabled_by),
  });

  // "Code wijzigen naar …" from an invitation conflict lands here.
  useEffect(() => {
    if (search.codeChange && isAdmin) setDialog("code");
  }, [search.codeChange, isAdmin]);
  const closeDialog = () => {
    setDialog(null);
    if (search.codeChange) void navigate({ search: {}, replace: true });
  };

  const business = customer.account_type === "business" && customer.company_name;
  const canInvite = !customer.user_id && !disabled && Boolean(customer.email) && !pendingInvitation;

  return (
    <>
      <header className="mb-6">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="min-w-0 break-words text-2xl text-primary sm:text-3xl">
            {business ? customer.company_name : customer.full_name}
          </h1>
          <span className="font-heading text-2xl font-bold text-primary tabular-nums sm:text-3xl">
            {customer.customer_code}
          </span>
        </div>
        {business ? <p className="mt-1 text-sm text-foreground">{customer.full_name}</p> : null}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <CustomerStatusBadge status={customer.status} className="px-3 py-1 text-sm" />
          <AccountTypeBadge type={customer.account_type} />
          {customer.user_id ? null : <NoLoginBadge className="px-2.5 py-0.5 text-xs" />}
          <span className="text-sm text-muted-foreground tabular-nums">
            {t("admin.customers.detail.since", { date: formatDate(customer.created_at) })}
          </span>
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          {disabled ? null : (
            <Button asChild>
              <Link to="/admin/orders/nieuw" search={{ customer: customer.id }}>
                <PackagePlus aria-hidden />
                {t("admin.customers.detail.newOrder")}
              </Link>
            </Button>
          )}
          <Button variant="outline" onClick={() => setDialog("contact")}>
            <Pencil aria-hidden />
            {t("admin.customers.detail.edit")}
          </Button>
          {canInvite ? (
            <Button variant="outline" onClick={() => setDialog("invite")}>
              <Send aria-hidden />
              {t("admin.invitations.section.invite")}
            </Button>
          ) : null}
          {customer.user_id && !disabled ? (
            <Button variant="outline" onClick={() => setDialog("recovery")}>
              <KeyRound aria-hidden />
              {t("admin.recovery.action")}
            </Button>
          ) : null}
          {isAdmin ? (
            <>
              <Button
                variant="outline"
                onClick={() => setDialog("code")}
                disabled={codeLocked}
                aria-describedby={codeLocked ? "customer-code-locked" : undefined}
              >
                <RefreshCcw aria-hidden />
                {t("admin.customers.detail.changeCode")}
              </Button>
              <Button
                variant={disabled ? "outline" : "destructive"}
                onClick={() => setDialog("disable")}
              >
                {disabled ? <CircleCheck aria-hidden /> : <Ban aria-hidden />}
                {disabled
                  ? t("admin.customers.detail.enable")
                  : t("admin.customers.detail.disable")}
              </Button>
            </>
          ) : null}
        </div>
        {isAdmin && codeLocked ? (
          <p id="customer-code-locked" className="mt-2 text-xs text-muted-foreground">
            {t("admin.customers.code.lockedShort", { code: customer.customer_code })}
          </p>
        ) : null}
      </header>

      {disabled ? (
        <Callout
          as="section"
          tone="danger"
          icon={Ban}
          title={t("admin.customers.detail.disabledTitle")}
          className="mb-6"
        >
          {customer.disabled_at ? (
            <p>
              {t("admin.customers.detail.disabledText", {
                date: formatDateTime(customer.disabled_at),
                name: personName(customer.disabled_by, people.data, null),
              })}
            </p>
          ) : null}
          {customer.disabled_reason ? (
            <p>
              {t("admin.customers.detail.disabledReason", { reason: customer.disabled_reason })}
            </p>
          ) : null}
          <p className="text-muted-foreground">{t("admin.customers.detail.disabledHint")}</p>
        </Callout>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-6">
          <ContactSection customer={customer} />
          <Section
            title={t("admin.customers.detail.accountTitle")}
            icon={ClipboardList}
            id="customer-account"
          >
            <DetailList>
              <DetailItem label={t("admin.customers.detail.status")}>
                <CustomerStatusBadge status={customer.status} />
              </DetailItem>
              <DetailItem label={t("admin.customers.detail.login")}>
                {customer.user_id
                  ? customer.email
                    ? t("admin.customers.detail.loginYes", { email: customer.email })
                    : t("admin.customers.detail.loginYesNoEmail")
                  : t("admin.customers.detail.loginNo")}
              </DetailItem>
              <DetailItem label={t("admin.customers.detail.terms")}>
                {customer.terms_accepted_at ? (
                  t("admin.customers.detail.termsAccepted", {
                    date: formatDateTime(customer.terms_accepted_at),
                    version: customer.terms_version ?? "–",
                  })
                ) : (
                  <Muted>{t("admin.customers.detail.termsNotAccepted")}</Muted>
                )}
              </DetailItem>
            </DetailList>
            <div className="mt-4 border-t pt-4">
              <h3 className="mb-2 text-sm font-bold text-primary">
                {t("admin.invitations.section.title")}
              </h3>
              <CustomerInvitationPanel
                userId={userId}
                customer={customer}
                invitations={invitations}
                onInvite={() => setDialog("invite")}
              />
            </div>
          </Section>
          <CustomerOrdersSection
            orders={orders.data}
            statuses={statuses.data ?? new Map()}
            error={orders.error ?? statuses.error}
            pending={orders.isPending || statuses.isPending}
            onRetry={() => {
              if (orders.isError) void orders.refetch();
              if (statuses.isError) void statuses.refetch();
            }}
            actions={
              disabled ? null : (
                <Button size="sm" variant="outline" asChild>
                  <Link to="/admin/orders/nieuw" search={{ customer: customer.id }}>
                    <PackagePlus aria-hidden />
                    {t("admin.customers.detail.newOrder")}
                  </Link>
                </Button>
              )
            }
          />
          <CustomerShipmentsSection orders={orders.data} />
          <CustomerInvoicesSection userId={userId} customerId={customer.id} />
          <CustomerDocumentsSection
            userId={userId}
            customerId={customer.id}
            customerUserId={customer.user_id}
          />
        </div>
        <div className="min-w-0 space-y-6">
          <CustomerNotes userId={userId} customerId={customer.id} />
          <CustomerTimeline
            userId={userId}
            isAdmin={isAdmin}
            customer={customer}
            invitations={invitations}
          />
        </div>
      </div>

      <CustomerContactDialog
        userId={userId}
        isAdmin={isAdmin}
        customer={customer}
        hasOpenInvitation={pendingInvitation}
        open={dialog === "contact"}
        onOpenChange={(open) => (open ? setDialog("contact") : closeDialog())}
      />
      <InviteCustomerDialog
        userId={userId}
        isAdmin={isAdmin}
        customer={summaryOf(customer)}
        open={dialog === "invite"}
        onOpenChange={(open) => (open ? setDialog("invite") : closeDialog())}
      />
      {dialog === "recovery" ? (
        <RecoveryLinkDialog
          userId={userId}
          customer={customer}
          open
          onOpenChange={(open) => (open ? setDialog("recovery") : closeDialog())}
        />
      ) : null}
      {isAdmin && dialog === "code" ? (
        <ChangeCodeDialog
          userId={userId}
          customer={customer}
          locked={codeLocked}
          initialCode={search.codeChange}
          open
          onOpenChange={(open) => (open ? setDialog("code") : closeDialog())}
        />
      ) : null}
      {isAdmin && dialog === "disable" ? (
        <DisableCustomerDialog
          userId={userId}
          customer={customer}
          open
          onOpenChange={(open) => (open ? setDialog("disable") : closeDialog())}
        />
      ) : null}
    </>
  );
}

function Value({ value }: { value: ReactNode }) {
  const t = useT();
  return value === null || value === undefined || value === "" ? (
    <Muted>{t("admin.customers.detail.notProvided")}</Muted>
  ) : (
    <>{value}</>
  );
}

function ContactSection({ customer }: { customer: CustomerRow }) {
  const t = useT();
  const tel = telHref(customer.phone);
  return (
    <Section
      title={t("admin.customers.detail.contactTitle")}
      icon={UserRound}
      id="customer-contact"
    >
      <DetailList>
        <DetailItem label={t("admin.customers.fields.fullName")}>
          <span className="font-semibold">{customer.full_name}</span>
        </DetailItem>
        <DetailItem label={t("admin.customers.fields.code")}>
          <span className="font-heading font-bold text-primary tabular-nums">
            {customer.customer_code}
          </span>
        </DetailItem>
        <DetailItem label={t("admin.customers.fields.accountType")}>
          {t(`admin.customers.accountTypes.${customer.account_type}`)}
        </DetailItem>
        {customer.account_type === "business" ? (
          <>
            <DetailItem label={t("admin.customers.fields.companyName")}>
              <Value value={customer.company_name} />
            </DetailItem>
            <DetailItem label={t("admin.customers.fields.contactPerson")}>
              <Value value={customer.contact_person} />
            </DetailItem>
            <DetailItem label={t("admin.customers.fields.kkfNumber")}>
              <Value value={customer.kkf_number} />
            </DetailItem>
          </>
        ) : null}
        <DetailItem label={t("admin.customers.fields.phone")}>
          {customer.phone ? (
            tel ? (
              <a
                href={tel}
                className="text-primary underline-offset-4 hover:underline tabular-nums"
              >
                {formatPhone(customer.phone)}
              </a>
            ) : (
              <span className="tabular-nums">{customer.phone}</span>
            )
          ) : (
            <Muted>{t("admin.customers.detail.notProvided")}</Muted>
          )}
        </DetailItem>
        <DetailItem label={t("admin.customers.fields.email")}>
          {customer.email ? (
            <a
              href={`mailto:${customer.email}`}
              className="break-all text-primary underline-offset-4 hover:underline"
            >
              {customer.email}
            </a>
          ) : (
            <Muted>{t("admin.customers.detail.notProvided")}</Muted>
          )}
        </DetailItem>
        <DetailItem label={t("admin.customers.fields.address")}>
          <Value value={customer.address} />
        </DetailItem>
        <DetailItem label={t("admin.customers.fields.district")}>
          <Value value={customer.district} />
        </DetailItem>
      </DetailList>
    </Section>
  );
}
