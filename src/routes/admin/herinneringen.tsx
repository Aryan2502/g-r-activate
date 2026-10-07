import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { Link, createFileRoute, getRouteApi } from "@tanstack/react-router";
import {
  BellRing,
  ChevronDown,
  History,
  Loader2,
  MailX,
  MessageCircle,
  Send,
  Settings,
  UserX,
} from "lucide-react";
import { toast } from "sonner";

import { Callout } from "@/components/admin/Callout";
import { EmailLogList } from "@/components/admin/reminders/EmailLogList";
import { ShellPageHeader } from "@/components/layout/AppShell";
import { LoadError, Muted, Section } from "@/components/portal/Section";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import { emailStatusQueryOptions } from "@/lib/admin/email";
import { whatsappHref } from "@/lib/admin/invitations";
import { adminKeys } from "@/lib/admin/keys";
import { customerDisplayName, customersQueryOptions } from "@/lib/admin/orders";
import {
  reminderOverviewQueryOptions,
  reminderPortalLink,
  reminderRows,
  reminderRunsQueryOptions,
  reminderShareText,
  runCounts,
  runSummary,
  withoutEmail,
  type JobRunRow,
  type ReminderRow,
} from "@/lib/admin/reminders";
import { runState } from "@/lib/admin/system-status";
import { emailOutcomeText } from "@/lib/email/outcome";
import type { ManualReminderResult, ReminderSettings } from "@/lib/email/reminders";
import { errorMessage } from "@/lib/errors";
import {
  formatDate,
  formatDateTime,
  formatMoney,
  formatNumber,
  todayInSuriname,
} from "@/lib/format";
import { t, useT } from "@/lib/i18n";
import { paths } from "@/lib/paths";
import { phoneDigits } from "@/lib/phone";
import { submitInvoiceReminder, submitRunReminders } from "@/lib/server-fns/reminders.functions";

/**
 * /admin/herinneringen (SPEC §19, §35.12), staff and admins: the open
 * invoices with what the daily run (09:00 Suriname) sends next and what was
 * sent (email_logs), the last runs (job_runs), "Herinneringen nu versturen"
 * (the same run, by hand) and per invoice "Herinnering nu versturen" (at
 * most one reminder per invoice per day, whichever route sent it; past the
 * maximum only after confirming). Every row offers "Herinner via WhatsApp"
 * (the main channel while e-mail is not configured, SPEC §35.12); customers
 * without an e-mail address are also listed apart. All numbers come from
 * Supabase.
 */
export const Route = createFileRoute("/admin/herinneringen")({
  head: () => ({ meta: [{ title: t("meta.pageTitle", { page: t("admin.reminders.title") }) }] }),
  component: RemindersPage,
});

const adminRoute = getRouteApi("/admin");

function RemindersPage() {
  const t = useT();
  const { auth } = adminRoute.useRouteContext();
  const userId = auth.userId;
  const queryClient = useQueryClient();
  const overview = useQuery(reminderOverviewQueryOptions(userId));
  const customers = useQuery(customersQueryOptions(userId));
  const runs = useQuery(reminderRunsQueryOptions(userId));
  const email = useQuery(emailStatusQueryOptions(userId));
  const [confirmRun, setConfirmRun] = useState(false);
  const today = todayInSuriname();

  const rows = useMemo(
    () =>
      overview.data && customers.data ? reminderRows(overview.data, customers.data, today) : null,
    [overview.data, customers.data, today],
  );
  const dueNow = rows
    ? rows.filter((r) => r.next && r.next.kind !== "max_reached" && r.next.date <= today).length
    : 0;

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: adminKeys.invoices(userId) }),
      queryClient.invalidateQueries({ queryKey: adminKeys.systemStatus(userId) }),
    ]);

  const run = useMutation({
    mutationFn: submitRunReminders,
    onSuccess: async (result) => {
      setConfirmRun(false);
      const summary = runSummary({ ...result.stats });
      if (result.status === "succeeded") toast.success(t("admin.reminders.runDone", { summary }));
      else
        toast.warning(t("admin.reminders.runFailed", { summary }), {
          description: result.error ?? undefined,
        });
      await refresh();
    },
    onError: (error) => {
      setConfirmRun(false);
      toast.error(t("admin.reminders.runError"), { description: errorMessage(error) });
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <ShellPageHeader
          className="mb-0"
          title={t("admin.reminders.title")}
          description={t("admin.reminders.intro")}
        />
        <Button className="shrink-0" onClick={() => setConfirmRun(true)} disabled={run.isPending}>
          {run.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <Send aria-hidden />}
          {run.isPending ? t("admin.reminders.running") : t("admin.reminders.runNow")}
        </Button>
      </div>

      {overview.data ? <SettingsLine settings={overview.data.settings} /> : null}

      {email.data?.configured === false ? (
        <Callout tone="warning" icon={MailX} title={t("admin.reminders.emailOff")} />
      ) : null}

      <RunsSection runs={runs} />

      <Section
        title={t("admin.reminders.open.title")}
        icon={BellRing}
        description={t("admin.reminders.open.intro")}
        id="open-invoices"
      >
        {overview.isError || customers.isError ? (
          <LoadError
            title={t("admin.reminders.open.loadFailed")}
            error={overview.error ?? customers.error}
            onRetry={() => {
              void overview.refetch();
              void customers.refetch();
            }}
          />
        ) : !rows || !overview.data ? (
          <Skeleton className="h-40 w-full" />
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("admin.reminders.open.empty")}</p>
        ) : (
          <ul className="divide-y" aria-label={t("admin.reminders.open.caption")}>
            {rows.map((row) => (
              <ReminderInvoiceItem
                key={row.invoice.id}
                row={row}
                settings={overview.data.settings}
                today={today}
                emailConfigured={email.data?.configured !== false}
                linkBase={email.data?.linkBase ?? null}
                onDone={refresh}
              />
            ))}
          </ul>
        )}
      </Section>

      <NoEmailSection rows={rows} today={today} linkBase={email.data?.linkBase ?? null} />

      <AlertDialog open={confirmRun} onOpenChange={(open) => !run.isPending && setConfirmRun(open)}>
        <AlertDialogContent className="w-[calc(100%-2rem)] rounded-lg bg-card">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-heading text-primary">
              {t("admin.reminders.runConfirm.title")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("admin.reminders.runConfirm.text")}
              {rows ? (
                <span className="mt-2 block font-semibold text-foreground">
                  {t("admin.reminders.runConfirm.dueNow", { count: formatNumber(dueNow, 0) })}
                </span>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel disabled={run.isPending}>
              {t("admin.reminders.runConfirm.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={run.isPending}
              onClick={(e) => {
                e.preventDefault();
                run.mutate();
              }}
            >
              {run.isPending ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <Send aria-hidden />
              )}
              {run.isPending
                ? t("admin.reminders.running")
                : t("admin.reminders.runConfirm.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function SettingsLine({ settings }: { settings: ReminderSettings }) {
  const t = useT();
  const dueSoon =
    settings.dueSoonDays <= 0
      ? t("admin.reminders.settingsDueSoonOff")
      : settings.dueSoonDays === 1
        ? t("admin.reminders.settingsDueSoonOne")
        : t("admin.reminders.settingsDueSoonDays", { days: settings.dueSoonDays });
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
      <span>
        {t("admin.reminders.settingsLine", {
          dueSoon,
          interval: settings.intervalDays,
          max: settings.maxOverdueReminders,
        })}
      </span>
      <Link
        to={paths.adminSettings}
        hash="herinneringen"
        className="inline-flex items-center gap-1 font-semibold text-primary underline-offset-4 hover:underline"
      >
        <Settings className="size-3.5" aria-hidden />
        {t("admin.reminders.settingsLink")}
      </Link>
    </p>
  );
}

// ---------------------------------------------------------------------------
// Last runs (job_runs)
// ---------------------------------------------------------------------------

function RunStatusBadge({ run }: { run: JobRunRow }) {
  const t = useT();
  const state = runState(run);
  return state === "succeeded" ? (
    <Badge variant="success">{t("admin.reminders.runs.statusSucceeded")}</Badge>
  ) : state === "failed" ? (
    <Badge variant="danger">{t("admin.reminders.runs.statusFailed")}</Badge>
  ) : state === "abandoned" ? (
    <Badge variant="danger">{t("admin.reminders.runs.statusAbandoned")}</Badge>
  ) : (
    <Badge variant="neutral">{t("admin.reminders.runs.statusRunning")}</Badge>
  );
}

function RunsSection({ runs }: { runs: UseQueryResult<JobRunRow[]> }) {
  const t = useT();
  return (
    <Section
      title={t("admin.reminders.runs.title")}
      icon={History}
      description={t("admin.reminders.runs.intro")}
      id="runs"
    >
      {runs.isError ? (
        <LoadError
          title={t("admin.reminders.runs.loadFailed")}
          error={runs.error}
          onRetry={() => void runs.refetch()}
        />
      ) : runs.isPending ? (
        <Skeleton className="h-24 w-full" />
      ) : runs.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("admin.reminders.runs.empty")}</p>
      ) : (
        <ul className="divide-y text-sm" aria-label={t("admin.reminders.runs.caption")}>
          {runs.data.map((run) => (
            <li
              key={run.id}
              className="grid gap-1 py-2.5 first:pt-0 last:pb-0 md:grid-cols-[12rem_7rem_7rem_1fr] md:items-start md:gap-3"
            >
              <span className="font-semibold tabular-nums text-foreground">
                {formatDateTime(run.started_at)}
              </span>
              <span className="text-muted-foreground">
                {run.trigger === "cron"
                  ? t("admin.reminders.runs.cron")
                  : t("admin.reminders.runs.manual")}
              </span>
              <span>
                <RunStatusBadge run={run} />
              </span>
              <span className="min-w-0 [overflow-wrap:anywhere]">
                {runSummary(run.stats)}
                <span className="block text-xs text-muted-foreground">
                  {t("admin.reminders.runs.checked", {
                    count: formatNumber(runCounts(run.stats).checked, 0),
                  })}
                </span>
                {run.error ? (
                  <span className="block text-xs text-destructive">{run.error}</span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// One open invoice
// ---------------------------------------------------------------------------

function nextText(row: ReminderRow, today: string): string {
  const next = row.next;
  if (!next) return t("admin.reminders.open.nextNone");
  if (next.kind === "max_reached") return t("admin.reminders.open.nextMax");
  const date = next.date <= today ? t("admin.reminders.open.nextToday") : formatDate(next.date);
  return next.kind === "payment_reminder_due_soon"
    ? t("admin.reminders.open.nextDueSoon", { date })
    : t("admin.reminders.open.nextOverdue", { seq: next.seq, date });
}

/** The toast after "Herinnering nu versturen" (null: the confirmation dialog opens instead). */
function announce(result: ManualReminderResult, number: string): void {
  switch (result.status) {
    case "not_due":
      toast.info(t("admin.reminders.sendResult.notDue", { number }));
      return;
    case "already_today":
      toast.info(t("admin.reminders.sendResult.alreadyToday", { number }));
      return;
    case "max_reached":
      toast.info(t("admin.reminders.sendResult.maxReached", { number, max: result.max }));
      return;
    case "sent_or_tried": {
      const text = t(
        result.kind === "payment_reminder_overdue"
          ? "admin.reminders.sendResult.overdue"
          : "admin.reminders.sendResult.dueSoon",
        { number, outcome: emailOutcomeText(result.outcome) },
      );
      if (result.outcome === "sent") toast.success(text);
      else if (result.outcome === "duplicate") toast.info(text);
      else toast.warning(text);
    }
  }
}

function ReminderInvoiceItem({
  row,
  settings,
  today,
  emailConfigured,
  linkBase,
  onDone,
}: {
  row: ReminderRow;
  settings: ReminderSettings;
  today: string;
  emailConfigured: boolean;
  linkBase: string | null;
  onDone: () => Promise<unknown>;
}) {
  const t = useT();
  const { invoice, customer } = row;
  const number = invoice.invoice_number ?? "";
  const hasEmail = Boolean(customer?.email?.trim());
  const days = invoice.days_overdue ?? 0;
  const count = invoice.reminder_count ?? 0;
  const [confirmMax, setConfirmMax] = useState(false);
  const send = useMutation({
    mutationFn: (force: boolean) =>
      submitInvoiceReminder({ invoiceId: invoice.id, confirmMax: force }),
    onSuccess: async (result) => {
      setConfirmMax(false);
      announce(result, number);
      await onDone();
    },
    onError: (error) => {
      setConfirmMax(false);
      toast.error(errorMessage(error));
    },
  });
  const phone = customer?.phone ?? null;
  const whatsapp = customer
    ? whatsappHref(phone, reminderShareText(row, reminderPortalLink(row, linkBase)))
    : null;

  return (
    <li className="py-4 first:pt-0 last:pb-0">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.3fr)_13rem] lg:items-start">
        <div className="min-w-0">
          <Link
            to="/admin/facturen/$id"
            params={{ id: invoice.id }}
            className="font-bold text-primary tabular-nums underline-offset-4 hover:underline"
          >
            {number}
          </Link>
          <p className="text-xs text-muted-foreground">
            {t("admin.reminders.open.due")}:{" "}
            <span className="tabular-nums">{formatDate(invoice.due_date)}</span>
          </p>
          {invoice.is_overdue && days > 0 ? (
            <p className="text-xs font-semibold text-destructive tabular-nums">
              {days === 1
                ? t("admin.reminders.open.daysOverdueOne")
                : t("admin.reminders.open.daysOverdue", { days: formatNumber(days, 0) })}
            </p>
          ) : null}
        </div>
        <div className="min-w-0">
          {customer ? (
            <>
              <Link
                to="/admin/klanten/$id"
                params={{ id: customer.id }}
                className="block break-words font-medium text-foreground underline-offset-4 hover:text-primary hover:underline"
              >
                {customerDisplayName(customer)}
              </Link>
              <span className="block text-xs font-semibold text-primary tabular-nums">
                {customer.customer_code}
              </span>
              {!hasEmail ? (
                <span className="mt-0.5 inline-flex items-center gap-1 text-xs text-warning">
                  <UserX className="size-3.5" aria-hidden />
                  {t("admin.reminders.open.noEmail")}
                </span>
              ) : null}
            </>
          ) : (
            <Muted>{t("admin.reminders.open.unknownCustomer")}</Muted>
          )}
        </div>
        <div className="text-sm">
          <span className="text-xs text-muted-foreground lg:hidden">
            {t("admin.reminders.open.balance")}:{" "}
          </span>
          <span className="font-semibold tabular-nums">
            {formatMoney(Number(invoice.balance_due ?? 0), invoice.currency)}
          </span>
        </div>
        <div className="min-w-0 text-sm">
          <p className="tabular-nums">
            {count > settings.maxOverdueReminders
              ? t("admin.reminders.open.countOverMax", {
                  count,
                  max: settings.maxOverdueReminders,
                })
              : t("admin.reminders.open.countValue", {
                  count,
                  max: settings.maxOverdueReminders,
                })}
            {invoice.last_reminder_sent_at ? (
              <span className="text-muted-foreground">
                {" "}
                ·{" "}
                {t("admin.reminders.open.lastSent", {
                  date: formatDate(invoice.last_reminder_sent_at),
                })}
              </span>
            ) : null}
          </p>
          <p className="text-xs text-muted-foreground">
            {t("admin.reminders.open.next")}: {nextText(row, today)}
          </p>
        </div>
        <div className="flex flex-col items-stretch gap-2 sm:flex-row lg:flex-col">
          <Button
            size="sm"
            variant="outline"
            className="lg:w-full"
            disabled={!hasEmail || row.sentToday || !row.manualKind || send.isPending}
            onClick={() => (row.maxReached ? setConfirmMax(true) : send.mutate(false))}
            aria-label={t("admin.reminders.open.sendNowLabel", { number })}
          >
            {send.isPending ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : (
              <Send aria-hidden />
            )}
            {send.isPending
              ? t("admin.reminders.open.sending")
              : row.sentToday
                ? t("admin.reminders.open.sentToday")
                : row.maxReached
                  ? t("admin.reminders.open.sendAnyway")
                  : t("admin.reminders.open.sendNow")}
          </Button>
          {whatsapp && row.manualKind ? (
            <Button
              asChild
              size="sm"
              variant={!emailConfigured || !hasEmail ? "outline" : "ghost"}
              className="lg:w-full"
            >
              <a
                href={whatsapp}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={t("admin.reminders.noEmail.whatsappLabel", { number })}
              >
                <MessageCircle aria-hidden />
                {t("admin.reminders.noEmail.whatsapp")}
              </a>
            </Button>
          ) : null}
        </div>
      </div>
      <AlertDialog
        open={confirmMax}
        onOpenChange={(open) => !send.isPending && setConfirmMax(open)}
      >
        <AlertDialogContent className="w-[calc(100%-2rem)] rounded-lg bg-card">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-heading text-primary">
              {t("admin.reminders.maxConfirm.title")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("admin.reminders.maxConfirm.text", {
                number,
                count,
                max: settings.maxOverdueReminders,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel disabled={send.isPending}>
              {t("admin.reminders.maxConfirm.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={send.isPending}
              onClick={(e) => {
                e.preventDefault();
                send.mutate(true);
              }}
            >
              {send.isPending ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <Send aria-hidden />
              )}
              {t("admin.reminders.maxConfirm.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Collapsible className="mt-2">
        <CollapsibleTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="group h-8 px-2 text-xs"
            aria-label={t("admin.reminders.open.historyLabel", { number })}
          >
            <ChevronDown
              className="size-3.5 transition-transform group-data-[state=open]:rotate-180"
              aria-hidden
            />
            {t("admin.reminders.open.history", { count: row.history.length })}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2 rounded-md border bg-cream/40 p-3">
          <EmailLogList logs={row.history} empty={t("admin.reminders.open.historyEmpty")} />
        </CollapsibleContent>
      </Collapsible>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Customers without e-mail: WhatsApp
// ---------------------------------------------------------------------------

function NoEmailSection({
  rows,
  today,
  linkBase,
}: {
  rows: ReminderRow[] | null;
  today: string;
  linkBase: string | null;
}) {
  const t = useT();
  if (!rows) return null;
  const list = withoutEmail(rows, today);
  return (
    <Section
      title={t("admin.reminders.noEmail.title")}
      icon={MessageCircle}
      description={t("admin.reminders.noEmail.intro")}
      id="no-email"
    >
      {list.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("admin.reminders.noEmail.empty")}</p>
      ) : (
        <ul className="divide-y text-sm">
          {list.map((row) => {
            const number = row.invoice.invoice_number ?? "";
            const phone = row.customer?.phone ?? null;
            return (
              <li
                key={row.invoice.id}
                className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="font-semibold text-foreground">
                    {row.customer ? customerDisplayName(row.customer) : ""}{" "}
                    <span className="text-primary tabular-nums">{row.customer?.customer_code}</span>
                  </p>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {number} ·{" "}
                    {formatMoney(Number(row.invoice.balance_due ?? 0), row.invoice.currency)} ·{" "}
                    {t("admin.reminders.open.due")} {formatDate(row.invoice.due_date)}
                  </p>
                  {phoneDigits(phone) === null ? (
                    <p className="text-xs text-muted-foreground">
                      {t("admin.reminders.noEmail.noPhone")}
                    </p>
                  ) : null}
                </div>
                <Button asChild size="sm" variant="outline" className="shrink-0">
                  <a
                    href={whatsappHref(
                      phone,
                      reminderShareText(row, reminderPortalLink(row, linkBase)),
                    )}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={t("admin.reminders.noEmail.whatsappLabel", { number })}
                  >
                    <MessageCircle aria-hidden />
                    {t("admin.reminders.noEmail.whatsapp")}
                  </a>
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}
