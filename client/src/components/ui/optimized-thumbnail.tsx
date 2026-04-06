import { useState, useCallback, useEffect, useMemo } from "react";
import { cn } from "@/lib/utils";
import { ImageIcon } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

interface OptimizedThumbnailProps {
  src: string;
  alt?: string;
  className?: string;
  containerClassName?: string;
  "data-testid"?: string;
  children?: React.ReactNode;
  /** Override default thumbnail widths. Defaults to [320, 480, 640, 960]. */
  widths?: number[];
}

/**
 * Converts an /objects/... path to a /api/thumbnails/... path at the given width.
 * External URLs (https://) are returned as-is since we can't resize them server-side.
 */
function thumbnailUrl(src: string, width: number): string {
  if (src.startsWith("/objects/")) {
    const objectPath = src.slice("/objects/".length);
    return `/api/thumbnails/${objectPath}?w=${width}`;
  }
  // External URLs — return unchanged
  return src;
}

/** Build srcSet for responsive images */
function buildSrcSet(src: string, widths: number[]): string | undefined {
  if (!src.startsWith("/objects/")) return undefined;
  return widths.map((w) => `${thumbnailUrl(src, w)} ${w}w`).join(", ");
}

const DEFAULT_WIDTHS = [320, 480, 640, 960];

export function OptimizedThumbnail({
  src,
  alt = "",
  className,
  containerClassName,
  "data-testid": testId,
  children,
  widths = DEFAULT_WIDTHS,
}: OptimizedThumbnailProps) {
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");

  useEffect(() => {
    if (!src) {
      setStatus("error");
    } else {
      setStatus("loading");
    }
  }, [src]);

  const handleLoad = useCallback(() => {
    setStatus("loaded");
  }, []);

  const handleError = useCallback(() => {
    setStatus("error");
  }, []);

  const isLocalObject = src?.startsWith("/objects/");

  // Use the smallest thumbnail as the default src for browsers that don't support srcSet
  const imgSrc = useMemo(
    () => (isLocalObject ? thumbnailUrl(src, widths[0]) : src),
    [src, isLocalObject, widths],
  );

  const srcSet = useMemo(
    () => buildSrcSet(src, widths),
    [src, widths],
  );

  return (
    <div
      className={cn("aspect-video overflow-hidden rounded-lg bg-muted relative", containerClassName)}
      data-testid={testId}
    >
      {status === "loading" && (
        <Skeleton className="absolute inset-0 w-full h-full rounded-none" />
      )}

      {status === "error" && (
        <div className="absolute inset-0 w-full h-full flex items-center justify-center">
          <ImageIcon className="w-12 h-12 text-muted-foreground/30" />
        </div>
      )}

      {src && (
        <img
          src={imgSrc}
          srcSet={srcSet}
          sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
          alt={alt}
          loading="lazy"
          decoding="async"
          onLoad={handleLoad}
          onError={handleError}
          className={cn(
            "w-full h-full object-cover transition-opacity duration-300",
            status === "loaded" ? "opacity-100" : "opacity-0",
            className
          )}
        />
      )}

      {children}
    </div>
  );
}
