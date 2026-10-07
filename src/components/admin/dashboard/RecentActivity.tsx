import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  Activity,
  ArrowRightLeft,
  Ban,
  Banknote,
  FileText,
  MailCheck,
  UserPlus,
  type LucideIcon,
} from "lucide-react";

import { DashboardPanel, PanelLoadError } from "@/components/admin/dashboard/Panel";
import { Skeleton } from "@/components/ui/skeleton";
import { recentActivityQueryOptions, type StaffActivity } from "@/lib/admin/dashboard";
import { peopleQueryOptions } from "@/lib/admin/orders";
import { adminStatusesQueryOptions } from "@/lib/admin/statuses";
import { formatDateTime, formatMoney } from "@/lib/format";
import { useT, type Translate } from "@/lib/i18n";

const ICONS: Record<StaffActivity["kind"], LucideIcon> = {
  status_changed: ArrowRightLeft,
  customer_created: UserPlus,
  invitation_accepted: MailCheck,
  invoice_issued: FileText,
  invoice_cancelled: Ban,
  payment_recorded: Banknote,
};

function itemText(
  t: Translate,
  item: StaffActivity,
  statusLabel: (code: string) => string,
): string {
  switch (item.kind) {
    case "status_changed":
      return t("admin.home.activity.statusChanged", {
        reference: item.reference ?? t("admin.home.activity.unknownOrder"),
        status: statusLabel(item.status),
      });
    case "customer_created":
      return t("admin.home.activity.customerCreated", {
        code: item.customer.customer_code,
        name: item.customer.full_name,
      });
    case "invitation_accepted":
      return item.invitationKind === "staff" || !item.customer
        ? t("admin.home.activity.invitationAcceptedStaff", { email: item.email })
        : t("admin.home.activity.invitationAcceptedCustomer", {
            name: item.customer.full_name,
            code: item.customer.customer_code,
          });
    case "invoice_issued":
      return t("admin.home.activity.invoiceIssued", {
        number: item.invoiceNumber ?? "–",
        amount: formatMoney(item.amount, item.currency),
      });
    case "invoice_cancelled":
      return t("admin.home.activity.invoiceCancelled", { number: item.invoiceNumber ?? "–" });
    case "payment_recorded": {
      const amount = item.currency ? formatMoney(item.amount, item.currency) : String(item.amount);
      return item.invoiceNumber
        ? t("admin.home.activity.paymentRecordedFor", { amount, number: item.invoiceNumber })
        : t("admin.home.activity.paymentRecorded", { amount });
    }
  }
}

/**
 * "Recente activiteit" (SPEC §12): status changes, new customers, accepted
 * invitations, issued/cancelled invoices and payments, newest first, each a
 * link to the order or the customer. Derived; there is no notifications
 * table (SPEC §35.7).
 */
export function RecentActivity({ userId }: { userId: string }) {
  const t = useT();
  const activity = useQuery(recentActivityQueryOptions(userId));
  const statuses = useQuery(adminStatusesQueryOptions(userId));
  const people = useQuery({
    ...peopleQueryOptions(
      userId,
      activity.data?.flatMap((i) => (i.kind === "status_changed" && i.by ? [i.by] : [])) ?? [],
    ),
    enabled: activity.isSuccess,
  });
  const statusLabel = (code: string) =>
    statuses.data?.get(code)?.label_nl ?? t("admin.home.activity.unknownStatus");

  return (
    <DashboardPanel
      title={t("admin.home.activity.title")}
      icon={<Activity />}
      description={t("admin.home.activity.intro")}
    >
      {activity.isError ? (
        <PanelLoadError error={activity.error} onRetry={() => void activity.refetch()} />
      ) : activity.isPending ? (
        <div className="space-y-3">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : activity.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("admin.home.activity.empty")}</p>
      ) : (
        <ol className="divide-y border-t">
          {activity.data.map((item) => {
            const Icon = ICONS[item.kind];
            const text = itemText(t, item, statusLabel);
            const customer = "customer" in item ? item.customer : null;
            const by = item.kind === "status_changed" && item.by ? people.data?.get(item.by) : null;
            return (
              <li key={item.key} className="flex gap-3 py-3 text-sm">
                <span
                  className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-cream text-primary"
                  aria-hidden
                >
                  <Icon className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="break-words font-medium text-foreground">
                    {item.kind === "status_changed" ? (
                      <Link
                        to="/admin/orders/$id"
                        params={{ id: item.orderId }}
                        className="text-primary underline underline-offset-2"
                      >
                        {text}
                      </Link>
                    ) : (
                      text
                    )}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    <span className="tabular-nums">{formatDateTime(item.at)}</span>
                    {by ? ` · ${t("admin.home.activity.by", { name: by })}` : null}
                    {customer &&
                    item.kind !== "customer_created" &&
                    item.kind !== "invitation_accepted" ? (
                      <>
                        {" · "}
                        <Link
                          to="/admin/klanten/$id"
                          params={{ id: customer.id }}
                          className="text-primary underline underline-offset-2"
                        >
                          {customer.full_name} ({customer.customer_code})
                        </Link>
                      </>
                    ) : null}
                    {customer &&
                    (item.kind === "customer_created" || item.kind === "invitation_accepted") ? (
                      <>
                        {" · "}
                        <Link
                          to="/admin/klanten/$id"
                          params={{ id: customer.id }}
                          className="text-primary underline underline-offset-2"
                          aria-label={`${t("admin.home.taskOpenCustomer")}: ${customer.full_name} (${customer.customer_code})`}
                        >
                          {t("admin.home.taskOpenCustomer")}
                        </Link>
                      </>
                    ) : null}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </DashboardPanel>
  );
}
