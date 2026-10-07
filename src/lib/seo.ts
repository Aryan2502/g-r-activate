import { brandAssets } from "./brand";
import { t } from "./i18n";

/** Keeps the portal, admin and auth pages out of search results (SPEC §35.2). */
export const NOINDEX_META = { name: "robots", content: "noindex, nofollow" } as const;

type Env = Record<string, string | undefined>;

/**
 * The public origin for absolute share/SEO URLs (og:image, og:url, canonical):
 * APP_URL, else Vercel's production domain, else null (then the image URL stays
 * relative). Mirrors getAppUrl() in src/server/env.ts but never throws: a bad
 * value only costs the absolute URLs, never the page.
 */
export function publicOriginFromEnv(env: Env): string | null {
  const appUrl = env["APP_URL"]?.trim();
  const vercel = env["VERCEL_PROJECT_PRODUCTION_URL"]?.trim();
  const raw = appUrl || (vercel ? `https://${vercel}` : "");
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (url.protocol !== "https:" && !(local && url.protocol === "http:")) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** Joins an origin and a root-relative path; a null origin keeps the path relative. */
export function absoluteUrl(origin: string | null, path: string): string {
  return origin ? new URL(path, origin).href : path;
}

type Meta = Record<string, string>;
type Link = { rel: string; href: string };

/**
 * Share and search tags for the public pages (homepage, terms, prohibited
 * goods): the brand image as og:image (1200 × 630, the logo photo on its own
 * #EEEBE4 paper, never stretched), a large Twitter/X card, and og:url plus a
 * canonical link once the public origin is known. WhatsApp, Facebook and
 * LinkedIn need ABSOLUTE image URLs, hence the origin.
 */
export function publicSeo(
  origin: string | null,
  pathname: string,
): { meta: Meta[]; links: Link[] } {
  const image = absoluteUrl(origin, brandAssets.ogImage.src);
  const meta: Meta[] = [
    { name: "robots", content: "index, follow" },
    { property: "og:image", content: image },
    { property: "og:image:type", content: "image/jpeg" },
    { property: "og:image:width", content: String(brandAssets.ogImage.width) },
    { property: "og:image:height", content: String(brandAssets.ogImage.height) },
    { property: "og:image:alt", content: t("brand.logoAlt") },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:image", content: image },
    { name: "twitter:image:alt", content: t("brand.logoAlt") },
  ];
  const links: Link[] = [];
  if (origin) {
    const url = absoluteUrl(origin, pathname || "/");
    meta.push({ property: "og:url", content: url });
    links.push({ rel: "canonical", href: url });
  }
  return { meta, links };
}

/** Title and description of one public page, also as og:/twitter: tags. */
export function pageMeta(title: string, description: string): Meta[] {
  return [
    { title },
    { name: "description", content: description },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: description },
  ];
}
