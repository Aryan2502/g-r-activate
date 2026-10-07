import { describe, expect, it } from "vitest";

import { brandAssets } from "./brand";
import { absoluteUrl, pageMeta, publicOriginFromEnv, publicSeo } from "./seo";

describe("publicOriginFromEnv()", () => {
  it("prefers APP_URL and keeps only its origin", () => {
    expect(
      publicOriginFromEnv({
        APP_URL: " https://portal.example.com/ ",
        VERCEL_PROJECT_PRODUCTION_URL: "gr-activate.vercel.app",
      }),
    ).toBe("https://portal.example.com");
  });

  it("falls back to Vercel's production domain", () => {
    expect(publicOriginFromEnv({ VERCEL_PROJECT_PRODUCTION_URL: "gr-activate.vercel.app" })).toBe(
      "https://gr-activate.vercel.app",
    );
  });

  it("returns null when nothing usable is set, never throws", () => {
    expect(publicOriginFromEnv({})).toBeNull();
    expect(publicOriginFromEnv({ APP_URL: "   " })).toBeNull();
    expect(publicOriginFromEnv({ APP_URL: "geen url" })).toBeNull();
    expect(publicOriginFromEnv({ APP_URL: "http://portal.example.com" })).toBeNull();
    expect(publicOriginFromEnv({ APP_URL: "http://localhost:8080" })).toBe("http://localhost:8080");
  });
});

describe("publicSeo()", () => {
  const find = (meta: Record<string, string>[], key: string) =>
    meta.find((m) => m["property"] === key || m["name"] === key)?.["content"];

  it("uses absolute URLs for the brand image, og:url and canonical when the origin is known", () => {
    const { meta, links } = publicSeo("https://portal.example.com", "/voorwaarden");
    expect(find(meta, "og:image")).toBe("https://portal.example.com/brand/gr-og-image.jpg");
    expect(find(meta, "twitter:image")).toBe("https://portal.example.com/brand/gr-og-image.jpg");
    expect(find(meta, "og:image:width")).toBe("1200");
    expect(find(meta, "og:image:height")).toBe("630");
    expect(find(meta, "twitter:card")).toBe("summary_large_image");
    expect(find(meta, "og:url")).toBe("https://portal.example.com/voorwaarden");
    expect(links).toEqual([{ rel: "canonical", href: "https://portal.example.com/voorwaarden" }]);
  });

  it("keeps the image relative and leaves out og:url/canonical without an origin", () => {
    const { meta, links } = publicSeo(null, "/");
    expect(find(meta, "og:image")).toBe(brandAssets.ogImage.src);
    expect(find(meta, "og:url")).toBeUndefined();
    expect(links).toEqual([]);
  });

  it("joins paths safely", () => {
    expect(absoluteUrl("https://portal.example.com", "/")).toBe("https://portal.example.com/");
    expect(absoluteUrl(null, "/x.jpg")).toBe("/x.jpg");
  });
});

describe("pageMeta()", () => {
  it("repeats title and description for share cards", () => {
    expect(pageMeta("Titel", "Omschrijving")).toEqual([
      { title: "Titel" },
      { name: "description", content: "Omschrijving" },
      { property: "og:title", content: "Titel" },
      { property: "og:description", content: "Omschrijving" },
      { name: "twitter:title", content: "Titel" },
      { name: "twitter:description", content: "Omschrijving" },
    ]);
  });
});
