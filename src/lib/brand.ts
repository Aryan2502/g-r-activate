// Single source for brand asset paths (SPEC §35.14). Swap these for a PNG/SVG later.
// The JPEGs are photos on #EEEBE4 paper: only place them on `bg-paper` surfaces.
export const brandAssets = {
  banner: { src: "/brand/gr-logo-banner.jpg", width: 1600, height: 926 },
  monogram: { src: "/brand/gr-monogram.jpg", width: 512, height: 512 },
  original: { src: "/brand/gr-logo-original.jpg", width: 2208, height: 1358 },
  favicon: "/favicon.ico",
  appleTouchIcon: "/apple-touch-icon.png",
  icon512: "/icon-512.png",
} as const;

export const BRAND_PAPER_HEX = "#EEEBE4";
export const BRAND_BACKGROUND_HEX = "#FAF8F4";
