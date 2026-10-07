import { useCallback, useRef, useState, type ReactNode } from "react";
import { useBlocker } from "@tanstack/react-router";
import { CircleDot } from "lucide-react";

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
import {
  UnsavedContext,
  type RegisterUnsaved,
  type UnsavedEntry,
} from "@/components/admin/settings/unsaved-context";
import { Badge } from "@/components/ui/badge";
import { useT } from "@/lib/i18n";

/**
 * /admin/instellingen has many small forms, each with its own "Opslaan"
 * (only that section's columns are written). An edit that is not saved yet
 * must not get lost unnoticed: every form reports whether it has unsaved
 * edits; the page then lists them in a bar that stays in view and asks before
 * leaving the page (links in the app, and the browser's own reload/close).
 */

export function UnsavedChangesProvider({ children }: { children: ReactNode }) {
  const t = useT();
  const [entries, setEntries] = useState<Record<string, UnsavedEntry>>({});
  const register = useCallback<RegisterUnsaved>((key, entry) => {
    setEntries((prev) => {
      if (entry === null) {
        if (!(key in prev)) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      }
      const old = prev[key];
      if (old && old.label === entry.label && old.anchor === entry.anchor) return prev;
      return { ...prev, [key]: entry };
    });
  }, []);

  const list = Object.values(entries);
  const dirty = list.length > 0;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  // Stable functions: useBlocker re-registers whenever they change.
  const shouldBlockFn = useCallback(
    ({ current, next }: { current: { pathname: string }; next: { pathname: string } }) =>
      dirtyRef.current && current.pathname !== next.pathname,
    [],
  );
  const enableBeforeUnload = useCallback(() => dirtyRef.current, []);
  const blocker = useBlocker({ shouldBlockFn, enableBeforeUnload, withResolver: true });

  // One link per section (the three bank accounts share one).
  const sections = [...new Map(list.map((e) => [e.label, e])).values()];

  return (
    <UnsavedContext.Provider value={register}>
      {children}
      {dirty ? (
        <div
          role="status"
          className="sticky bottom-3 z-20 mt-6 flex flex-col gap-2 rounded-lg border border-warning/50 bg-warning-soft px-4 py-3 text-sm text-foreground shadow-md sm:flex-row sm:flex-wrap sm:items-center"
        >
          <span className="flex items-center gap-2 font-semibold">
            <CircleDot className="size-4 shrink-0 text-warning" aria-hidden />
            {t("admin.settings.unsaved.bar")}
          </span>
          <ul className="flex flex-wrap gap-x-3 gap-y-1">
            {sections.map((e) => (
              <li key={e.label}>
                <a
                  href={`#${e.anchor}`}
                  className="font-semibold text-primary underline underline-offset-4"
                >
                  {e.label}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <AlertDialog
        open={blocker.status === "blocked"}
        onOpenChange={(open) => {
          if (!open && blocker.status === "blocked") blocker.reset();
        }}
      >
        <AlertDialogContent className="w-[calc(100%-2rem)] rounded-lg bg-card">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-heading text-primary">
              {t("admin.settings.unsaved.title")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("admin.settings.unsaved.text", {
                sections: sections.map((e) => e.label).join(", "),
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel onClick={() => blocker.reset?.()}>
              {t("admin.settings.unsaved.stay")}
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => blocker.proceed?.()}
            >
              {t("admin.settings.unsaved.leave")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </UnsavedContext.Provider>
  );
}

/** "Niet opgeslagen", next to a form's save button. */
export function UnsavedBadge({ dirty }: { dirty: boolean }) {
  const t = useT();
  if (!dirty) return null;
  return (
    <Badge variant="warning" className="self-center">
      <CircleDot className="size-3.5 shrink-0" aria-hidden />
      {t("admin.settings.unsaved.badge")}
    </Badge>
  );
}
