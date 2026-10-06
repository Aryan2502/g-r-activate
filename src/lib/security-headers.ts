// Only the app itself and the Lovable editor (which previews the app in an
// iframe) may frame these pages; anything else could clickjack them.
const FRAME_ANCESTORS = [
  "'self'",
  "https://lovable.dev",
  "https://*.lovable.dev",
  "https://gptengineer.app",
  "https://*.gptengineer.app",
];

/** Response headers for every server-rendered page (root route `headers`). */
export function securityHeaders(dev = false): Record<string, string> {
  const ancestors = dev ? [...FRAME_ANCESTORS, "http://localhost:3000"] : FRAME_ANCESTORS;
  return {
    "Content-Security-Policy": `frame-ancestors ${ancestors.join(" ")}`,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
  };
}
