import type { ReactNode } from "react";

import { SiteFooter } from "@/components/layout/SiteFooter";
import { SiteHeader } from "@/components/layout/SiteHeader";
import type { PublicCompanyInfo } from "@/lib/company-info";

/** Header + footer shell for public pages. `info` is null when company settings could not load. */
export function PublicLayout({
  info,
  children,
}: {
  info: PublicCompanyInfo | null;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader signupEnabled={info?.public_signup_enabled ?? false} />
      <main className="flex-1">{children}</main>
      <SiteFooter info={info} />
    </div>
  );
}
