import { paths } from "@/lib/paths";

/**
 * Where Supabase email links return to. Client auth calls use the current
 * origin (SPEC §35.2); every origin used must be on Supabase's redirect
 * allow-list (docs/DEPLOYMENT.md).
 */
export function confirmRedirectUrl(origin: string = window.location.origin): string {
  return `${origin}${paths.authConfirm}`;
}
