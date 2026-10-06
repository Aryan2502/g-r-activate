import { useRouter } from "@tanstack/react-router";
import { AlertTriangle, RotateCw } from "lucide-react";

import { Markdown } from "@/components/content/Markdown";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n";

interface LegalPageProps {
  title: string;
  /** Markdown from company_settings; null/empty = not published yet. */
  markdown: string | null | undefined;
  /** false when company settings could not be loaded at all. */
  loaded: boolean;
  version?: string | null | undefined;
}

export function LegalPage({ title, markdown, loaded, version }: LegalPageProps) {
  const t = useT();
  const router = useRouter();
  const body = markdown?.trim();

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:py-16">
      <h1 className="text-3xl text-primary">{title}</h1>
      {version ? (
        <p className="mt-2 text-sm text-muted-foreground tabular-nums">
          {t("legal.version", { version })}
        </p>
      ) : null}
      <div className="mt-8 rounded-lg border bg-card p-6 sm:p-8">
        {!loaded ? (
          <div role="alert" className="flex flex-col items-start gap-4">
            <p className="flex items-center gap-2 text-sm text-destructive">
              <AlertTriangle className="size-4" aria-hidden />
              {t("legal.loadFailed")}
            </p>
            <Button variant="outline" onClick={() => void router.invalidate()}>
              <RotateCw aria-hidden />
              {t("common.retry")}
            </Button>
          </div>
        ) : body ? (
          <Markdown>{body}</Markdown>
        ) : (
          <p className="text-sm text-muted-foreground">{t("legal.notPublished")}</p>
        )}
      </div>
    </div>
  );
}
