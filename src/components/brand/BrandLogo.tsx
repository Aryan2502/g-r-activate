import { brandAssets } from "@/lib/brand";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export type BrandLogoVariant = "banner" | "monogram" | "lockup";
export type BrandLogoSize = "sm" | "md" | "lg";

export interface BrandLogoProps {
  variant: BrandLogoVariant;
  /** Monogram tile / lockup scale. Ignored for the banner, which fills its container width. */
  size?: BrandLogoSize;
  /** Load eagerly with high fetch priority (above-the-fold usage). */
  priority?: boolean;
  className?: string;
}

const tileSize: Record<BrandLogoSize, string> = {
  sm: "size-8",
  md: "size-10",
  lg: "size-14",
};

const nameSize: Record<BrandLogoSize, string> = {
  sm: "text-[13px]",
  md: "text-[15px] sm:text-base",
  lg: "text-xl",
};

// The tagline stays on one line; below 360px the md lockup tightens so the
// header's menu button still fits.
const taglineSize: Record<BrandLogoSize, string> = {
  sm: "text-[9px] tracking-[0.14em]",
  md: "text-[9px] tracking-[0.08em] min-[360px]:text-[9.5px] min-[360px]:tracking-[0.14em] sm:text-[10px]",
  lg: "text-xs tracking-[0.14em]",
};

function MonogramTile({
  size,
  alt,
  priority,
  className,
}: {
  size: BrandLogoSize;
  alt: string;
  priority: boolean;
  className?: string | undefined;
}) {
  const { src, width, height } = brandAssets.monogram;
  return (
    <span
      className={cn(
        "inline-block shrink-0 overflow-hidden rounded-md bg-paper ring-1 ring-border/70",
        tileSize[size],
        className,
      )}
    >
      <img
        src={src}
        width={width}
        height={height}
        alt={alt}
        aria-hidden={alt === "" ? true : undefined}
        loading={priority ? "eager" : "lazy"}
        decoding="async"
        className="block size-full object-cover"
      />
    </span>
  );
}

/**
 * The only way to render the G&R logo (SPEC §35.14). The JPEG sources always sit
 * on a #EEEBE4 (`bg-paper`) surface and are never stretched or recoloured.
 */
export function BrandLogo({ variant, size = "md", priority = false, className }: BrandLogoProps) {
  const t = useT();

  if (variant === "banner") {
    const { src, width, height } = brandAssets.banner;
    return (
      <div className={cn("bg-paper", className)}>
        <img
          src={src}
          width={width}
          height={height}
          alt={t("brand.logoAlt")}
          loading={priority ? "eager" : "lazy"}
          fetchPriority={priority ? "high" : "auto"}
          decoding="async"
          className="mx-auto block h-auto w-full object-contain"
        />
      </div>
    );
  }

  if (variant === "monogram") {
    return (
      <MonogramTile
        size={size}
        alt={t("brand.monogramAlt")}
        priority={priority}
        className={className}
      />
    );
  }

  return (
    <span className={cn("inline-flex items-center gap-3", className)}>
      <MonogramTile size={size} alt="" priority={priority} />
      <span className="flex flex-col leading-none">
        <span
          className={cn("font-heading font-bold tracking-[0.02em] text-primary", nameSize[size])}
        >
          {t("brand.companyName")}
        </span>
        <span
          className={cn(
            "mt-1 whitespace-nowrap font-medium uppercase text-brand-grey",
            taglineSize[size],
          )}
        >
          {t("brand.tagline")}
        </span>
      </span>
    </span>
  );
}
