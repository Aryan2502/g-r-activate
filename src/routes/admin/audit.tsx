import { useEffect, useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute, getRouteApi, useNavigate } from "@tanstack/react-router";
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FileSearch,
  Lock,
  UserRound,
  XCircle,
} from "lucide-react";

import { Callout, FieldError } from "@/components/admin/Callout";
import { ExportCsvButton } from "@/components/admin/ExportCsvButton";
import { ShellPageHeader } from "@/components/layout/AppShell";
import { LoadError } from "@/components/portal/Section";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AUDIT_TABLES,
  auditActionLabel,
  auditDiff,
  auditPageQueryOptions,
  auditRangeInvalid,
  auditRecordLabel,
  auditRecordLink,
  auditSearchSchema,
  auditTableLabel,
  formatAuditValue,
  hasAuditFilters,
  type AuditEntry,
  type AuditFilters,
  type AuditSearch,
} from "@/lib/admin/audit";
import { exportAudit } from "@/lib/admin/exports";
import { peopleQueryOptions } from "@/lib/admin/orders";
import { teamQueryOptions } from "@/lib/admin/team-queries";
import { formatDateTime } from "@/lib/format";
import { t, useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * /admin/audit (SPEC §28, §35.13): the generic audit_log for admins — when,
 * who, which table, what action and which columns changed — with filters
 * (table, who, Suriname date range, record id) that run in the database,
 * 50 rows a page, a drawer with every field old next to new plus the raw
 * JSON, and "Exporteer CSV" of everything the filters match. audit_log is
 * admin-read only (RLS); staff see an explanation instead.
 */
export const Route = createFileRoute("/admin/audit")({
  validateSearch: (search: Record<string, unknown>): AuditSearch => auditSearchSchema.parse(search),
  head: () => ({ meta: [{ title: t("meta.pageTitle", { page: t("admin.audit.title") }) }] }),
  component: AuditPage,
});

const adminRoute = getRouteApi("/admin");
const ALL = "all";

function AuditPage() {
  const t = useT();
  const { auth } = adminRoute.useRouteContext();
  const header = (
    <ShellPageHeader title={t("admin.audit.title")} description={t("admin.audit.intro")} />
  );
  if (auth.role !== "admin") {
    return (
      <>
        {header}
        <Callout tone="neutral" icon={Lock} title={t("admin.audit.adminOnlyTitle")}>
          <p>{t("admin.audit.adminOnlyText")}</p>
        </Callout>
      </>
    );
  }
  return (
    <>
      {header}
      <AuditBoard userId={auth.userId} />
    </>
  );
}

function useSetSearch() {
  const navigate = useNavigate({ from: Route.fullPath });
  return (patch: Partial<AuditSearch>, opts: { keepPage?: boolean } = {}) =>
    void navigate({
      search: (prev) => {
        // A new filter starts at page 1.
        const next: AuditSearch = {
          ...prev,
          ...(opts.keepPage ? {} : { page: undefined }),
          ...patch,
        };
        for (const key of Object.keys(next) as (keyof AuditSearch)[]) {
          if (next[key] === undefined) delete next[key];
        }
        if (next.page === 1) delete next.page;
        return next;
      },
      replace: !opts.keepPage,
    });
}

function AuditBoard({ userId }: { userId: string }) {
  const t = useT();
  const search = Route.useSearch();
  const setSearch = useSetSearch();
  const page = search.page ?? 1;
  const filters: AuditFilters = {
    table: search.table,
    actor: search.actor,
    from: search.from,
    to: search.to,
    record: search.record,
  };
  const invalidRange = auditRangeInvalid(filters);
  const audit = useQuery({
    ...auditPageQueryOptions(userId, filters, page),
    enabled: !invalidRange,
  });
  const entries = audit.data?.entries ?? [];
  const actorIds = [...entries.map((e) => e.actor_id), search.actor ?? null].filter(
    (id): id is string => Boolean(id),
  );
  const people = useQuery({
    ...peopleQueryOptions(userId, actorIds),
    enabled: actorIds.length > 0,
  });
  const [open, setOpen] = useState<AuditEntry | null>(null);

  const name = (id: string | null) =>
    id
      ? (people.data?.get(id) ?? t("admin.audit.filters.otherActor", { id: id.slice(0, 8) }))
      : t("admin.audit.system");

  return (
    <>
      <Filters
        userId={userId}
        search={search}
        invalidRange={invalidRange}
        actorName={search.actor ? name(search.actor) : null}
      />
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground tabular-nums" aria-live="polite">
          {audit.data ? t("admin.audit.page", { page }) : null}
        </p>
        {!invalidRange && entries.length > 0 ? (
          <ExportCsvButton
            options={[
              {
                label: t("admin.exports.what.audit"),
                run: () => exportAudit({ filters }),
              },
            ]}
          />
        ) : null}
      </div>

      {invalidRange ? null : audit.isError ? (
        <div className="rounded-lg border bg-card p-6 shadow-sm">
          <LoadError
            title={t("admin.audit.loadFailed")}
            error={audit.error}
            onRetry={() => void audit.refetch()}
          />
        </div>
      ) : audit.isPending ? (
        <div className="space-y-3" aria-busy="true">
          <span className="sr-only">{t("common.loading")}</span>
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : entries.length === 0 ? (
        <div className="flex flex-col items-start gap-3 rounded-lg border bg-card p-6 shadow-sm">
          <p className="text-sm text-foreground">
            {hasAuditFilters(search) ? t("admin.audit.noResults") : t("admin.audit.noRows")}
          </p>
          {hasAuditFilters(search) ? <ClearFiltersButton /> : null}
        </div>
      ) : (
        <div className={cn(audit.isPlaceholderData && "opacity-60 transition-opacity")}>
          <AuditTable entries={entries} name={name} onOpen={setOpen} />
          <AuditCards entries={entries} name={name} onOpen={setOpen} />
          <nav
            aria-label={t("admin.audit.pagination")}
            className="mt-4 flex items-center justify-between gap-3"
          >
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setSearch({ page: page - 1 }, { keepPage: true })}
            >
              <ChevronLeft aria-hidden />
              {t("admin.audit.previous")}
            </Button>
            <span className="text-sm text-muted-foreground tabular-nums">
              {t("admin.audit.page", { page })}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={!audit.data?.hasMore}
              onClick={() => setSearch({ page: page + 1 }, { keepPage: true })}
            >
              {t("admin.audit.next")}
              <ChevronRight aria-hidden />
            </Button>
          </nav>
        </div>
      )}

      <AuditDrawer
        entry={open}
        actorName={open ? name(open.actor_id) : ""}
        onOpenChange={(o) => {
          if (!o) setOpen(null);
        }}
        onFilter={(patch) => {
          setOpen(null);
          setSearch(patch);
        }}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Filters (in the URL, applied in the database)
// ---------------------------------------------------------------------------

function ClearFiltersButton() {
  const t = useT();
  const setSearch = useSetSearch();
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() =>
        setSearch({
          table: undefined,
          actor: undefined,
          from: undefined,
          to: undefined,
          record: undefined,
        })
      }
    >
      <XCircle aria-hidden />
      {t("admin.audit.filters.clear")}
    </Button>
  );
}

function Filters({
  userId,
  search,
  invalidRange,
  actorName,
}: {
  userId: string;
  search: AuditSearch;
  invalidRange: boolean;
  /** The selected actor's name (also when they are not on the team list). */
  actorName: string | null;
}) {
  const t = useT();
  const id = useId();
  const setSearch = useSetSearch();
  const team = useQuery(teamQueryOptions(userId));
  const [record, setRecord] = useState(search.record ?? "");

  useEffect(() => {
    setRecord(search.record ?? "");
  }, [search.record]);
  useEffect(() => {
    const value = record.trim();
    if (value === (search.record ?? "")) return;
    const timer = window.setTimeout(() => setSearch({ record: value || undefined }), 400);
    return () => window.clearTimeout(timer);
    // setSearch is recreated each render; the URL value is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record, search.record]);

  const members = team.data?.members ?? [];
  const actorListed = !search.actor || members.some((m) => m.userId === search.actor);
  const rangeErrorId = `${id}-range-error`;

  return (
    <div
      role="search"
      className="mb-4 grid gap-3 rounded-lg border bg-card p-4 shadow-sm sm:grid-cols-2 xl:grid-cols-5"
    >
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-table`}>{t("admin.audit.filters.table")}</Label>
        <Select
          value={search.table ?? ALL}
          onValueChange={(v) =>
            setSearch({ table: v === ALL ? undefined : AUDIT_TABLES.find((x) => x === v) })
          }
        >
          <SelectTrigger id={`${id}-table`} className="h-10">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t("admin.audit.filters.allTables")}</SelectItem>
            {AUDIT_TABLES.map((table) => (
              <SelectItem key={table} value={table}>
                {auditTableLabel(table)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`${id}-actor`}>{t("admin.audit.filters.actor")}</Label>
        <Select
          value={search.actor ?? ALL}
          onValueChange={(v) => setSearch({ actor: v === ALL ? undefined : v })}
        >
          <SelectTrigger id={`${id}-actor`} className="h-10">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t("admin.audit.filters.allActors")}</SelectItem>
            {members.map((m) => (
              <SelectItem key={m.userId} value={m.userId}>
                {m.displayName ?? m.email ?? m.userId.slice(0, 8)}
              </SelectItem>
            ))}
            {!actorListed && search.actor ? (
              <SelectItem value={search.actor}>{actorName ?? search.actor}</SelectItem>
            ) : null}
          </SelectContent>
        </Select>
        {team.isError ? (
          <p className="text-xs text-muted-foreground">{t("admin.audit.filters.teamLoadFailed")}</p>
        ) : null}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`${id}-from`}>{t("admin.audit.filters.from")}</Label>
        <Input
          id={`${id}-from`}
          type="date"
          className="h-10"
          value={search.from ?? ""}
          max={search.to}
          aria-invalid={invalidRange || undefined}
          aria-describedby={invalidRange ? rangeErrorId : undefined}
          onChange={(e) => setSearch({ from: e.target.value || undefined })}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`${id}-to`}>{t("admin.audit.filters.to")}</Label>
        <Input
          id={`${id}-to`}
          type="date"
          className="h-10"
          value={search.to ?? ""}
          min={search.from}
          aria-invalid={invalidRange || undefined}
          aria-describedby={invalidRange ? rangeErrorId : undefined}
          onChange={(e) => setSearch({ to: e.target.value || undefined })}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`${id}-record`}>{t("admin.audit.filters.record")}</Label>
        <Input
          id={`${id}-record`}
          type="search"
          className="h-10 font-mono text-xs sm:text-sm"
          value={record}
          maxLength={200}
          autoComplete="off"
          spellCheck={false}
          placeholder={t("admin.audit.filters.recordPlaceholder")}
          onChange={(e) => setRecord(e.target.value)}
        />
      </div>

      {invalidRange || hasAuditFilters(search) ? (
        <div className="space-y-2 sm:col-span-2 xl:col-span-5">
          <FieldError
            id={rangeErrorId}
            message={invalidRange ? t("admin.audit.filters.rangeInvalid") : null}
          />
          {hasAuditFilters(search) ? <ClearFiltersButton /> : null}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rows: a table from xl, cards below
// ---------------------------------------------------------------------------

const ACTION_TONE = { INSERT: "success", UPDATE: "info", DELETE: "danger" } as const;

function ActionBadge({ action }: { action: string }) {
  const tone =
    action === "INSERT" || action === "UPDATE" || action === "DELETE"
      ? ACTION_TONE[action]
      : "neutral";
  return <Badge variant={tone}>{auditActionLabel(action)}</Badge>;
}

function ChangedColumns({ entry }: { entry: AuditEntry }) {
  const t = useT();
  const columns = entry.changed_columns ?? [];
  if (columns.length === 0) {
    return <span className="text-muted-foreground">{t("admin.audit.noChangedColumns")}</span>;
  }
  const shown = columns.slice(0, 4);
  return (
    <span className="break-words font-mono text-xs">
      {shown.join(", ")}
      {columns.length > shown.length ? (
        <span className="text-muted-foreground">
          {" "}
          {t("admin.audit.changedMore", { count: columns.length - shown.length })}
        </span>
      ) : null}
    </span>
  );
}

function DetailsButton({ entry, onOpen }: { entry: AuditEntry; onOpen: (e: AuditEntry) => void }) {
  const t = useT();
  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-8 text-primary"
      onClick={() => onOpen(entry)}
      aria-label={t("admin.audit.detailsLabel", {
        table: auditTableLabel(entry.table_name),
        action: auditActionLabel(entry.action),
        time: formatDateTime(entry.occurred_at),
      })}
    >
      <FileSearch aria-hidden />
      {t("admin.audit.details")}
    </Button>
  );
}

type RowProps = {
  entries: AuditEntry[];
  name: (id: string | null) => string;
  onOpen: (e: AuditEntry) => void;
};

function AuditTable({ entries, name, onOpen }: RowProps) {
  const t = useT();
  return (
    <div className="relative hidden overflow-x-auto rounded-lg border bg-card shadow-sm xl:block">
      <table className="w-full text-sm">
        <caption className="sr-only">{t("admin.audit.caption")}</caption>
        <thead className="border-b bg-cream text-left">
          <tr>
            {(["time", "actor", "table", "action", "record", "changed"] as const).map((c) => (
              <th key={c} scope="col" className="px-4 py-3 font-bold text-primary">
                {t(`admin.audit.columns.${c}`)}
              </th>
            ))}
            <th scope="col" className="px-2 py-3">
              <span className="sr-only">{t("admin.audit.columns.details")}</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {entries.map((entry) => (
            <tr key={entry.id} className="align-top">
              <td className="whitespace-nowrap px-4 py-3 tabular-nums">
                {formatDateTime(entry.occurred_at)}
              </td>
              <td className="px-4 py-3 break-words">{name(entry.actor_id)}</td>
              <td className="px-4 py-3">{auditTableLabel(entry.table_name)}</td>
              <td className="px-4 py-3">
                <ActionBadge action={entry.action} />
              </td>
              <td className="max-w-64 px-4 py-3 break-words">{auditRecordLabel(entry)}</td>
              <td className="max-w-72 px-4 py-3">
                <ChangedColumns entry={entry} />
              </td>
              <td className="px-2 py-2 text-right">
                <DetailsButton entry={entry} onOpen={onOpen} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AuditCards({ entries, name, onOpen }: RowProps) {
  const t = useT();
  return (
    <ul className="grid gap-3 md:grid-cols-2 xl:hidden" aria-label={t("admin.audit.caption")}>
      {entries.map((entry) => (
        <li key={entry.id} className="min-w-0 rounded-lg border bg-card p-4 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-semibold text-foreground">{auditTableLabel(entry.table_name)}</p>
              <p className="text-xs text-muted-foreground tabular-nums">
                {formatDateTime(entry.occurred_at)}
              </p>
            </div>
            <ActionBadge action={entry.action} />
          </div>
          <p className="mt-2 break-words text-sm">{auditRecordLabel(entry)}</p>
          <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
            <UserRound className="size-3.5 shrink-0" aria-hidden />
            <span className="min-w-0 break-words">{name(entry.actor_id)}</span>
          </p>
          <div className="mt-2 text-sm">
            <ChangedColumns entry={entry} />
          </div>
          <div className="mt-2 -ml-3">
            <DetailsButton entry={entry} onOpen={onOpen} />
          </div>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// The JSON diff drawer
// ---------------------------------------------------------------------------

function Value({ value }: { value: Parameters<typeof formatAuditValue>[0] }) {
  const text = formatAuditValue(value);
  return (
    <code
      className={cn(
        "block whitespace-pre-wrap break-all font-mono text-xs",
        value === null && "italic text-muted-foreground",
      )}
    >
      {text}
    </code>
  );
}

function AuditDrawer({
  entry,
  actorName,
  onOpenChange,
  onFilter,
}: {
  entry: AuditEntry | null;
  actorName: string;
  onOpenChange: (open: boolean) => void;
  onFilter: (patch: Partial<AuditSearch>) => void;
}) {
  const t = useT();
  const [showAll, setShowAll] = useState(false);
  useEffect(() => setShowAll(false), [entry?.id]);

  const rows = entry ? auditDiff(entry) : [];
  const changed = rows.filter((r) => r.changed);
  const unchanged = rows.length - changed.length;
  const visible = showAll ? rows : changed;
  const link = entry ? auditRecordLink(entry) : null;
  const twoSided = entry?.action === "UPDATE";

  return (
    <Sheet open={entry !== null} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl">
        {entry ? (
          <>
            <SheetHeader className="pr-8">
              <SheetTitle className="flex flex-wrap items-center gap-2">
                {auditTableLabel(entry.table_name)}
                <ActionBadge action={entry.action} />
              </SheetTitle>
              <SheetDescription>{t("admin.audit.drawer.description")}</SheetDescription>
            </SheetHeader>

            <dl className="mt-5 grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
              <dt className="text-muted-foreground">{t("admin.audit.drawer.when")}</dt>
              <dd className="tabular-nums">{formatDateTime(entry.occurred_at)}</dd>
              <dt className="text-muted-foreground">{t("admin.audit.drawer.who")}</dt>
              <dd className="min-w-0 break-words">
                {actorName}
                {entry.actor_id ? (
                  <Button
                    variant="link"
                    size="sm"
                    className="block h-auto p-0 text-left"
                    onClick={() => onFilter({ actor: entry.actor_id ?? undefined })}
                  >
                    {t("admin.audit.onlyActor", { name: actorName })}
                  </Button>
                ) : null}
              </dd>
              <dt className="text-muted-foreground">{t("admin.audit.drawer.table")}</dt>
              <dd className="min-w-0 break-words">
                {auditTableLabel(entry.table_name)}{" "}
                <code className="font-mono text-xs text-muted-foreground">{entry.table_name}</code>
              </dd>
              <dt className="text-muted-foreground">{t("admin.audit.drawer.record")}</dt>
              <dd className="min-w-0 break-words">
                {auditRecordLabel(entry)}
                {link ? (
                  <Link
                    to={link.to}
                    params={{ id: link.id }}
                    className="ml-2 inline-flex items-center gap-1 font-semibold text-primary underline-offset-4 hover:underline"
                  >
                    <ExternalLink className="size-3.5" aria-hidden />
                    {t("admin.audit.drawer.open")}
                  </Link>
                ) : null}
              </dd>
              {entry.record_id ? (
                <>
                  <dt className="text-muted-foreground">{t("admin.audit.drawer.recordId")}</dt>
                  <dd className="min-w-0">
                    <code className="block break-all font-mono text-xs">{entry.record_id}</code>
                    <Button
                      variant="link"
                      size="sm"
                      className="h-auto p-0 text-left"
                      onClick={() =>
                        onFilter({
                          record: entry.record_id ?? undefined,
                          table: AUDIT_TABLES.find((x) => x === entry.table_name),
                        })
                      }
                    >
                      {t("admin.audit.onlyRecord")}
                    </Button>
                  </dd>
                </>
              ) : null}
              {entry.reason ? (
                <>
                  <dt className="text-muted-foreground">{t("admin.audit.drawer.reason")}</dt>
                  <dd className="min-w-0 whitespace-pre-line break-words">{entry.reason}</dd>
                </>
              ) : null}
            </dl>

            <h3 className="mt-6 text-sm font-bold text-primary">
              {entry.action === "INSERT"
                ? t("admin.audit.drawer.createdTitle")
                : entry.action === "DELETE"
                  ? t("admin.audit.drawer.deletedTitle")
                  : t("admin.audit.drawer.changesTitle")}
            </h3>
            {visible.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">
                {t("admin.audit.drawer.noFields")}
              </p>
            ) : (
              <div className="mt-2 overflow-x-auto rounded-md border">
                <table className="w-full table-fixed text-sm">
                  <thead className="bg-cream text-left">
                    <tr>
                      <th scope="col" className="w-1/4 px-3 py-2 font-bold text-primary">
                        {t("admin.audit.drawer.field")}
                      </th>
                      {twoSided ? (
                        <>
                          <th scope="col" className="px-3 py-2 font-bold text-primary">
                            {t("admin.audit.drawer.before")}
                          </th>
                          <th scope="col" className="px-3 py-2 font-bold text-primary">
                            {t("admin.audit.drawer.after")}
                          </th>
                        </>
                      ) : (
                        <th scope="col" className="px-3 py-2 font-bold text-primary">
                          {t("admin.audit.drawer.value")}
                        </th>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {visible.map((row) => (
                      <tr
                        key={row.key}
                        className={cn("align-top", twoSided && row.changed && "bg-warning-soft/50")}
                      >
                        <th
                          scope="row"
                          className="break-all px-3 py-2 text-left font-mono text-xs font-semibold"
                        >
                          {row.key}
                        </th>
                        {twoSided ? (
                          <>
                            <td className="px-3 py-2">
                              <Value value={row.before} />
                            </td>
                            <td className="px-3 py-2">
                              <Value value={row.after} />
                            </td>
                          </>
                        ) : (
                          <td className="px-3 py-2">
                            <Value value={entry.action === "DELETE" ? row.before : row.after} />
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {twoSided && unchanged > 0 ? (
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => setShowAll((v) => !v)}
                aria-expanded={showAll}
              >
                {showAll
                  ? t("admin.audit.drawer.showChanged")
                  : t("admin.audit.drawer.showAll", { count: unchanged })}
              </Button>
            ) : null}

            <details className="mt-6 rounded-md border p-3 text-sm">
              <summary className="cursor-pointer font-semibold text-primary">
                {t("admin.audit.drawer.rawTitle")}
              </summary>
              {entry.old_data !== null ? (
                <>
                  <p className="mt-3 text-xs font-semibold text-muted-foreground">
                    {t("admin.audit.drawer.oldJson")}
                  </p>
                  <pre className="mt-1 max-h-80 overflow-auto rounded bg-muted p-2 font-mono text-xs whitespace-pre-wrap break-all">
                    {JSON.stringify(entry.old_data, null, 2)}
                  </pre>
                </>
              ) : null}
              {entry.new_data !== null ? (
                <>
                  <p className="mt-3 text-xs font-semibold text-muted-foreground">
                    {t("admin.audit.drawer.newJson")}
                  </p>
                  <pre className="mt-1 max-h-80 overflow-auto rounded bg-muted p-2 font-mono text-xs whitespace-pre-wrap break-all">
                    {JSON.stringify(entry.new_data, null, 2)}
                  </pre>
                </>
              ) : null}
            </details>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
