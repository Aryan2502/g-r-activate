import { paths } from "@/lib/paths";

export type AppRole = "admin" | "staff" | "customer";

const PROBE_ORIGIN = "https://redirect.invalid";

/**
 * Returns `value` only when it is a same-site path such as "/portal?x=1"
 * (SPEC §35.2): it must start with "/" and not "//"; backslashes and control
 * characters are refused because browsers read "/\evil.com" as "//evil.com".
 */
export function safeRedirect(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f || code === 0x5c /* \ */) return null;
  }
  try {
    if (new URL(value, PROBE_ORIGIN).origin !== PROBE_ORIGIN) return null;
  } catch {
    return null;
  }
  return value;
}

export function isStaffRole(role: AppRole): boolean {
  return role === "admin" || role === "staff";
}

export function homePathForRole(role: AppRole): string {
  return isStaffRole(role) ? paths.admin : paths.portal;
}

function pathnameOf(path: string): string {
  return path.split(/[?#]/, 1)[0] ?? path;
}

function within(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(`${base}/`);
}

// Pages that make no sense right after signing in (they would loop or log out).
const AUTH_PAGES = [paths.login, paths.signup, paths.forgotPassword, "/auth"];

/**
 * Where to go after signing in: a valid `?redirect` the role may open, else
 * /admin for staff and /portal for customers (SPEC §35.2).
 */
export function postLoginPath(role: AppRole, redirect: unknown): string {
  const target = safeRedirect(redirect);
  if (target) {
    const pathname = pathnameOf(target);
    const blocked =
      AUTH_PAGES.some((page) => within(pathname, page)) ||
      within(pathname, isStaffRole(role) ? paths.portal : paths.admin);
    if (!blocked) return target;
  }
  return homePathForRole(role);
}
