import { useState } from "react";
import { ChevronDown, Download, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { CsvExport } from "@/lib/admin/exports";
import { downloadCsv } from "@/lib/csv";
import { errorMessage } from "@/lib/errors";
import { useT } from "@/lib/i18n";

export interface CsvExportOption {
  /** "Klanten", "Facturen met regels", … */
  label: string;
  run: () => Promise<CsvExport>;
}

/** Runs an export, downloads the file and says how it went (toast). */
function useCsvExport() {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const run = async (option: CsvExportOption) => {
    if (busy) return;
    setBusy(true);
    try {
      const file = await option.run();
      downloadCsv(file.filename, file.csv);
      toast.success(
        file.rows === 0
          ? t("admin.exports.doneEmpty", { file: file.filename })
          : file.rows === 1
            ? t("admin.exports.doneOne", { file: file.filename })
            : t("admin.exports.done", { file: file.filename, count: file.rows }),
      );
    } catch (error) {
      toast.error(t("admin.exports.failed"), { description: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  };
  return { busy, run };
}

/**
 * "Exporteer CSV" (SPEC §35.15, admins): one export, or a menu when a page
 * offers several (invoices with lines, their payments). The file is built in
 * the browser from RLS-scoped reads and downloaded; nothing is stored.
 */
export function ExportCsvButton({
  options,
  scope,
  className,
}: {
  options: readonly [CsvExportOption, ...CsvExportOption[]];
  /** "Met de huidige filters: 12." — what the file will hold, for the label. */
  scope?: string;
  className?: string;
}) {
  const t = useT();
  const { busy, run } = useCsvExport();
  const icon = busy ? <Loader2 className="animate-spin" aria-hidden /> : <Download aria-hidden />;
  const text = busy ? t("admin.exports.busy") : t("admin.exports.button");

  if (options.length === 1) {
    const [only] = options;
    return (
      <Button
        variant="outline"
        size="sm"
        className={className}
        disabled={busy}
        aria-busy={busy}
        title={scope}
        aria-label={[t("admin.exports.buttonLabel", { what: only.label }), scope]
          .filter(Boolean)
          .join(". ")}
        onClick={() => void run(only)}
      >
        {icon}
        {text}
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={className}
          disabled={busy}
          aria-busy={busy}
          title={scope}
        >
          {icon}
          {text}
          <ChevronDown aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-w-[calc(100vw-2rem)]">
        <DropdownMenuLabel>{t("admin.exports.menuLabel")}</DropdownMenuLabel>
        {scope ? (
          <p className="px-2 pb-1.5 text-xs text-muted-foreground tabular-nums">{scope}</p>
        ) : null}
        <DropdownMenuSeparator />
        {options.map((option) => (
          <DropdownMenuItem key={option.label} onSelect={() => void run(option)}>
            <Download aria-hidden />
            {option.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
