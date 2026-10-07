import { createIsomorphicFn } from "@tanstack/react-start";

import { publicOriginFromEnv } from "./seo";

/**
 * Origin for the public pages' share/SEO tags. On the server (SSR, what
 * crawlers and WhatsApp see) it comes from APP_URL or Vercel's production
 * domain, never from the Host header; in the browser (client-side navigation)
 * it is the page's own origin. Read in the /_public loader, so the SSR value is
 * reused when the page hydrates.
 */
export const getSiteOrigin = createIsomorphicFn()
  .server((): string | null => publicOriginFromEnv(process.env))
  .client((): string | null => window.location.origin);
