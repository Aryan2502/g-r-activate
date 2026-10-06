import { brandAssets } from "./brand";
import { t } from "./i18n";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Static fallback served by server.ts/start.ts when SSR itself fails, so it
// cannot rely on the app's CSS or fonts. Colours mirror the §35.14 tokens.
export function renderErrorPage(): string {
  const title = escapeHtml(t("errors.errorTitle"));
  return `<!doctype html>
<html lang="nl">
  <head>
    <meta charset="utf-8" />
    <title>${title}</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <link rel="icon" href="${brandAssets.favicon}" />
    <style>
      body { font: 15px/1.5 Inter, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif; background: #FAF8F4; color: #2B2724; display: grid; place-items: center; min-height: 100vh; margin: 0; padding: 1.5rem; box-sizing: border-box; }
      .card { max-width: 28rem; width: 100%; text-align: center; padding: 2rem; background: #fff; border: 1px solid #D8D2C9; border-radius: 0.5rem; box-sizing: border-box; }
      .tile { width: 56px; height: 56px; border-radius: 0.375rem; background: #EEEBE4; display: block; margin: 0 auto 1.5rem; }
      h1 { font: 700 1.25rem/1.3 Montserrat, Inter, system-ui, sans-serif; margin: 0 0 0.5rem; }
      p { color: #6B645C; margin: 0 0 1.5rem; font-size: 0.875rem; }
      .actions { display: flex; gap: 0.5rem; justify-content: center; flex-wrap: wrap; }
      a, button { padding: 0.5rem 1rem; border-radius: 0.375rem; font-family: inherit; font-size: 0.875rem; font-weight: 500; line-height: 1.25rem; cursor: pointer; text-decoration: none; border: 1px solid transparent; }
      .primary { background: #713A28; color: #fff; }
      .primary:hover { background: #5A3122; }
      .secondary { background: #fff; color: #2B2724; border-color: #8F857A; }
    </style>
  </head>
  <body>
    <div class="card">
      <img class="tile" src="${brandAssets.monogram.src}" width="56" height="56" alt="${escapeHtml(t("brand.monogramAlt"))}" />
      <h1>${title}</h1>
      <p>${escapeHtml(t("errors.errorText"))}</p>
      <div class="actions">
        <button class="primary" onclick="location.reload()">${escapeHtml(t("common.retry"))}</button>
        <a class="secondary" href="/">${escapeHtml(t("common.backHome"))}</a>
      </div>
    </div>
  </body>
</html>`;
}
