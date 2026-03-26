import { useState, useCallback, useEffect } from "react";
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
}

export function OptimizedThumbnail({
  src,
  alt = "",
  className,
  containerClassName,
  "data-testid": testId,
  children,
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
          src={src}
          alt={alt}
          loading="lazy"
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
