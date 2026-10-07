import type { ComponentType, ReactNode, SVGProps } from "react";
import { AlertTriangle } from "lucide-react";

import { cn } from "@/lib/utils";

/** An inline field error under an input (pair it with aria-describedby). */
export function FieldError({ id, message }: { id: string; message: string | null }) {
  if (!message) return null;
  return (
    <p id={id} className="flex items-start gap-1.5 text-[0.8rem] font-medium text-destructive">
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      {message}
    </p>
  );
}

const TONES = {
  warning: "border-warning/40 bg-warning-soft [&_[data-icon]]:text-warning",
  danger: "border-destructive/30 bg-destructive-soft [&_[data-icon]]:text-destructive",
  info: "border-info/30 bg-info-soft [&_[data-icon]]:text-info",
  success: "border-success/40 bg-success-soft [&_[data-icon]]:text-success",
  neutral: "border-border bg-neutral-soft [&_[data-icon]]:text-neutral",
} as const;

/**
 * A boxed note with an icon and a bold title, in the status colours (SPEC
 * §35.14; text plus icon, never colour alone). For dialogs and page banners.
 */
export function Callout({
  tone,
  icon: Icon,
  title,
  children,
  actions,
  className,
  as: Tag = "div",
}: {
  tone: keyof typeof TONES;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  title: string;
  children?: ReactNode;
  /** Buttons under the text. */
  actions?: ReactNode;
  className?: string;
  /** "section" for a page banner with its own heading level. */
  as?: "div" | "section";
}) {
  return (
    <Tag className={cn("flex gap-3 rounded-md border p-3 text-sm", TONES[tone], className)}>
      <Icon data-icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1 leading-6 text-foreground">
        {Tag === "section" ? (
          <h2 className="text-base font-bold">{title}</h2>
        ) : (
          <p className="font-semibold">{title}</p>
        )}
        {children ? <div className="mt-0.5">{children}</div> : null}
        {actions ? <div className="mt-3 flex flex-wrap gap-2">{actions}</div> : null}
      </div>
    </Tag>
  );
}
