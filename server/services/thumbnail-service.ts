import sharp from "sharp";
import { LRUCache } from "./lru-cache";

/** Allowed thumbnail widths to prevent abuse */
const ALLOWED_WIDTHS = [160, 320, 480, 640, 960] as const;
type AllowedWidth = (typeof ALLOWED_WIDTHS)[number];

/** In-memory LRU cache for generated thumbnails (50 MB budget) */
const thumbnailCache = new LRUCache<Buffer>(50 * 1024 * 1024);

/** Image content types we can resize */
const RESIZABLE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/bmp",
]);

export function isResizableContentType(contentType: string | undefined): boolean {
  return !!contentType && RESIZABLE_TYPES.has(contentType);
}

/**
 * Snap a requested width to the nearest allowed width.
 * Clamps to the range [min, max] of ALLOWED_WIDTHS for out-of-range values.
 */
export function snapWidth(requested: number): AllowedWidth {
  if (!Number.isFinite(requested) || requested <= 0) return ALLOWED_WIDTHS[0];
  let nearest = ALLOWED_WIDTHS[0];
  let minDist = Math.abs(requested - nearest);
  for (const w of ALLOWED_WIDTHS) {
    const dist = Math.abs(requested - w);
    if (dist < minDist) {
      minDist = dist;
      nearest = w;
    }
  }
  return nearest;
}

/**
 * Generate (or return cached) a thumbnail for the given object.
 * Returns { buffer, contentType } or null if the source isn't resizable.
 */
export async function generateThumbnail(
  sourceStream: NodeJS.ReadableStream,
  sourceContentType: string,
  cacheKey: string,
  width: AllowedWidth,
): Promise<{ buffer: Buffer; contentType: string } | null> {
  if (!isResizableContentType(sourceContentType)) return null;

  const fullKey = `${cacheKey}:${width}`;
  const cached = thumbnailCache.get(fullKey);
  if (cached) {
    return { buffer: cached, contentType: "image/webp" };
  }

  // Collect stream into buffer then resize
  const chunks: Buffer[] = [];
  for await (const chunk of sourceStream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const sourceBuffer = Buffer.concat(chunks);

  const buffer = await sharp(sourceBuffer)
    .resize(width, undefined, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: 75 })
    .toBuffer();

  thumbnailCache.set(fullKey, buffer, buffer.length);
  return { buffer, contentType: "image/webp" };
}
