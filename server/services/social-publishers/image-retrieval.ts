/**
 * Shared image-retrieval helper for social publishers (Task #777).
 *
 * Scheduled posts frequently failed with image_fetch_failed because the
 * publishers loaded each post's `/public-objects/...` image with a single
 * HTTP self-request through the app's own route — one transient hiccup
 * burned an entire publish attempt.
 *
 * This helper makes image retrieval robust:
 *  - Own-storage images (`/public-objects/...`) are read directly from
 *    object storage via ObjectStorageService — bytes in-process, no HTTP
 *    self-request at all.
 *  - Genuinely external URLs are fetched over HTTP with fast in-place
 *    retries for transient failures (network errors, 5xx, timeouts).
 *  - Permanent failures throw typed errors immediately:
 *      image_not_found  — 404 / missing storage object (replace the image)
 *      image_forbidden  — 401/403 (auth-gated path, re-upload to public)
 *      image_fetch_failed — transient failure that survived all retries
 *
 * SharePoint/SPE URLs are NOT handled here — the publishers keep their
 * existing authenticated Graph branch.
 */

import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { Agent } from "undici";
import { ObjectStorageService, ObjectNotFoundError } from "../../replit_integrations/object_storage/objectStorage";

export type ImageErrorCode = "image_not_found" | "image_forbidden" | "image_fetch_failed";

export class ImageRetrievalError extends Error {
  code: ImageErrorCode;
  /** true when retrying later could plausibly succeed */
  transient: boolean;
  constructor(code: ImageErrorCode, message: string, transient = false) {
    super(message);
    this.name = "ImageRetrievalError";
    this.code = code;
    this.transient = transient;
    Object.setPrototypeOf(this, ImageRetrievalError.prototype);
  }
}

export interface RetrievedImage {
  buffer: Buffer;
  contentType: string;
}

/** Fast in-place retry schedule for transient failures (ms). */
const RETRY_DELAYS_MS = [500, 1500];
const FETCH_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 3;
/**
 * Hard cap on image bytes buffered in-process (HTTP and storage paths).
 * Social platforms cap images well below this (LinkedIn/Twitter ≤ ~10 MB),
 * so anything larger is unusable anyway — reject instead of buffering.
 */
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

/**
 * Read an HTTP response body as a stream with an accumulating byte limit,
 * aborting immediately on overflow.
 */
async function readBodyCapped(resp: globalThis.Response, sourceUrl: string): Promise<Buffer> {
  const oversize = () =>
    new ImageRetrievalError(
      "image_fetch_failed",
      `The image at ${sourceUrl} exceeds the ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)} MB limit. Use Change Image (🖼) to pick a smaller graphic.`,
    );
  const declared = Number(resp.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) {
    resp.body?.cancel().catch(() => {});
    throw oversize();
  }
  if (!resp.body) return Buffer.from(await resp.arrayBuffer());
  const reader = resp.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_IMAGE_BYTES) {
        await reader.cancel().catch(() => {});
        throw oversize();
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock?.();
  }
  return Buffer.concat(chunks);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// SSRF guard — external image URLs are editor-controlled, so server-side
// fetches must never reach internal services. Only http(s) destinations that
// resolve to public unicast addresses are allowed; redirects are followed
// manually and each hop is re-validated.
// ---------------------------------------------------------------------------

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = parts;
  return (
    a === 0 ||                       // "this network"
    a === 10 ||                      // private
    a === 127 ||                     // loopback
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) ||      // link-local / cloud metadata
    (a === 172 && b >= 16 && b <= 31) || // private
    (a === 192 && b === 0) ||        // IETF reserved (192.0.0.0/24, 192.0.2.0/24)
    (a === 192 && b === 168) ||      // private
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    a >= 224                          // multicast + reserved
  );
}

/**
 * Parse an IPv6 literal into its 8 16-bit groups. Handles "::" compression,
 * zone ids, and an embedded dotted-quad tail. Returns null if unparseable.
 */
function parseIPv6Groups(ip: string): number[] | null {
  let s = ip.split("%")[0].toLowerCase();
  // Embedded IPv4 tail → convert to two hex groups first.
  const v4 = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) {
    const parts = v4[1].split(".").map(Number);
    if (parts.length !== 4 || parts.some((n) => n > 255)) return null;
    s = s.slice(0, -v4[1].length) +
      ((parts[0] << 8) | parts[1]).toString(16) + ":" + ((parts[2] << 8) | parts[3]).toString(16);
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const toGroups = (part: string) =>
    part === "" ? [] : part.split(":").map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN));
  const head = toGroups(halves[0]);
  const tail = halves.length === 2 ? toGroups(halves[1]) : [];
  if (head.some(Number.isNaN) || tail.some(Number.isNaN)) return null;
  const fill = 8 - head.length - tail.length;
  if (halves.length === 2 ? fill < 0 : head.length !== 8) return null;
  return halves.length === 2 ? [...head, ...new Array(fill).fill(0), ...tail] : head;
}

function isPrivateIPv6(ip: string): boolean {
  const g = parseIPv6Groups(ip);
  if (!g) return true; // unparseable — treat as unsafe
  const isZero = (upto: number) => g.slice(0, upto).every((x) => x === 0);
  // :: (unspecified) and ::1 (loopback)
  if (isZero(7) && (g[7] === 0 || g[7] === 1)) return true;
  const embeddedV4 = () => `${g[6] >> 8}.${g[6] & 0xff}.${g[7] >> 8}.${g[7] & 0xff}`;
  // IPv4-mapped ::ffff:0:0/96 and IPv4-compatible ::a.b.c.d — classify the
  // embedded IPv4 (covers WHATWG-normalized forms like ::ffff:7f00:1).
  if (isZero(5) && (g[5] === 0xffff || g[5] === 0)) return isPrivateIPv4(embeddedV4());
  // NAT64 well-known prefix 64:ff9b::/96
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) {
    return isPrivateIPv4(embeddedV4());
  }
  const top = g[0];
  return (
    (top & 0xfe00) === 0xfc00 || // fc00::/7 unique-local
    (top & 0xffc0) === 0xfe80 || // fe80::/10 link-local
    (top & 0xff00) === 0xff00 || // ff00::/8 multicast
    top === 0x2001 && g[1] === 0x0db8 // documentation
  );
}

function isPrivateIp(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return isPrivateIPv4(ip);
  if (family === 6) return isPrivateIPv6(ip);
  return true; // not an IP literal at all — caller resolves via DNS
}

interface ValidatedTarget {
  url: URL;
  /** The exact public address the connection must be pinned to. */
  pinnedAddress: string;
  pinnedFamily: 4 | 6;
}

/**
 * A dns.lookup-compatible function that always answers with the address that
 * passed SSRF validation, regardless of what DNS would say at connect time.
 * This closes the DNS-rebinding TOCTOU: validate-then-fetch uses ONE address.
 * Exported for tests.
 */
export function makePinnedLookup(address: string, family: 4 | 6) {
  return (_hostname: string, options: any, callback?: any) => {
    const cb = typeof options === "function" ? options : callback;
    if (options && typeof options === "object" && options.all) {
      cb(null, [{ address, family }]);
    } else {
      cb(null, address, family);
    }
  };
}

/**
 * Validate an external URL for server-side fetching: http(s) only, and the
 * host (literal or DNS-resolved, all addresses) must be publicly routable.
 * Throws a permanent ImageRetrievalError on violation.
 */
async function assertPublicHttpUrl(rawUrl: string): Promise<ValidatedTarget> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new ImageRetrievalError("image_fetch_failed", `Invalid image URL: ${rawUrl}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ImageRetrievalError("image_forbidden", `Image URL uses unsupported protocol ${url.protocol} — only http(s) images are allowed.`);
  }
  const host = url.hostname.replace(/^\[|\]$/g, ""); // strip IPv6 brackets
  const literalFamily = isIP(host);
  if (literalFamily) {
    if (isPrivateIp(host)) {
      throw new ImageRetrievalError("image_forbidden", `Image URL points at a private/internal address (${host}) — use a public image URL.`);
    }
    return { url, pinnedAddress: host, pinnedFamily: literalFamily as 4 | 6 };
  }
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new ImageRetrievalError("image_forbidden", `Image URL points at an internal hostname (${host}) — use a public image URL.`);
  }
  let addrs: Array<{ address: string; family: number }>;
  try {
    addrs = await dnsLookup(host, { all: true });
  } catch {
    throw new ImageRetrievalError("image_fetch_failed", `Image host ${host} did not resolve.`, true);
  }
  if (addrs.length === 0 || addrs.some((a) => isPrivateIp(a.address))) {
    throw new ImageRetrievalError("image_forbidden", `Image host ${host} resolves to a private/internal address — use a public image URL.`);
  }
  // Pin the connection to the first validated address so a second resolution
  // at connect time (DNS rebinding) can never swap in a private target.
  const pin = addrs[0];
  return { url, pinnedAddress: pin.address, pinnedFamily: (pin.family === 6 ? 6 : 4) };
}

/**
 * fetch() with manual redirect handling: every hop (including redirect
 * targets) is validated against the SSRF guard before being requested.
 */
async function guardedFetch(rawUrl: string): Promise<globalThis.Response> {
  let current = rawUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const { url, pinnedAddress, pinnedFamily } = await assertPublicHttpUrl(current);
    // Connect through an agent whose DNS lookup is pinned to the validated
    // address (Host header + TLS SNI still use the original hostname). This
    // prevents DNS rebinding between validation and connection.
    const dispatcher = new Agent({ connect: { lookup: makePinnedLookup(pinnedAddress, pinnedFamily) as any } });
    let resp: globalThis.Response;
    try {
      resp = await fetch(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        dispatcher,
      } as RequestInit & { dispatcher: Agent });
    } finally {
      dispatcher.close().catch(() => {});
    }
    if (resp.status >= 300 && resp.status < 400) {
      const location = resp.headers.get("location");
      if (!location) return resp;
      current = new URL(location, url).toString();
      continue;
    }
    return resp;
  }
  throw new ImageRetrievalError("image_fetch_failed", `Image URL exceeded ${MAX_REDIRECTS} redirects: ${rawUrl}`);
}

/**
 * Extract the `/public-objects/...` file path from a URL that targets the
 * app's own public-object route, whether stored relative or absolute.
 * Returns null for genuinely external URLs.
 */
export function publicObjectPath(imageUrl: string): string | null {
  let pathname = imageUrl;
  if (!imageUrl.startsWith("/")) {
    try {
      pathname = decodeURI(new URL(imageUrl).pathname);
    } catch {
      return null;
    }
  }
  if (!pathname.startsWith("/public-objects/")) return null;
  const filePath = pathname.slice("/public-objects/".length);
  if (!filePath || filePath.includes("..")) return null;
  return filePath;
}

/**
 * Detect a `/objects/uploads/...` path — the auth-gated private-upload route.
 * These are stored in PRIVATE_OBJECT_DIR and must be read via getObjectEntityFile,
 * not via searchPublicObject or HTTP fetch (HTTP fails: relative URL, no host).
 * Returns the normalised `/objects/uploads/...` path, or null for other URLs.
 */
export function objectEntityPath(imageUrl: string): string | null {
  let pathname = imageUrl;
  if (!imageUrl.startsWith("/")) {
    try {
      pathname = decodeURI(new URL(imageUrl).pathname);
    } catch {
      return null;
    }
  }
  if (!pathname.startsWith("/objects/")) return null;
  if (pathname.includes("..")) return null;
  return pathname;
}

function isTransientStorageError(err: unknown): boolean {
  const anyErr = err as any;
  const status = Number(anyErr?.code ?? anyErr?.response?.status ?? NaN);
  // GCS client errors carry HTTP-ish codes; 4xx (except 429) are permanent.
  if (Number.isFinite(status) && status >= 400 && status < 500 && status !== 429) return false;
  return true;
}

/**
 * Retrieve the bytes of a post image.
 *
 * - `/public-objects/...` (relative or absolute) → direct object-storage read via searchPublicObject.
 * - `/objects/uploads/...` (relative or absolute) → direct read via getObjectEntityFile (private bucket).
 * - anything else → HTTP fetch with retries.
 *
 * Throws ImageRetrievalError with a typed code on failure.
 */
export async function fetchImageBytes(
  imageUrl: string,
  opts: { retryDelaysMs?: number[]; storage?: ObjectStorageService } = {},
): Promise<RetrievedImage> {
  const delays = opts.retryDelaysMs ?? RETRY_DELAYS_MS;

  // Private-upload branch: /objects/uploads/... — read directly from the
  // private GCS bucket without going through HTTP (which fails: relative URL).
  const entityPath = objectEntityPath(imageUrl);
  if (entityPath) {
    const storage = opts.storage ?? new ObjectStorageService();
    let lastErr: unknown = null;
    for (let attempt = 0; attempt <= delays.length; attempt++) {
      try {
        const file = await storage.getObjectEntityFile(entityPath);
        const [metadata] = await file.getMetadata();
        const declaredSize = Number((metadata as any).size);
        if (Number.isFinite(declaredSize) && declaredSize > MAX_IMAGE_BYTES) {
          throw new ImageRetrievalError(
            "image_fetch_failed",
            `The stored image is ${Math.round(declaredSize / 1024 / 1024)} MB — over the ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)} MB limit. Use Change Image (🖼) to replace it with a smaller graphic.`,
          );
        }
        const [contents] = await file.download();
        if ((contents as Buffer).byteLength > MAX_IMAGE_BYTES) {
          throw new ImageRetrievalError(
            "image_fetch_failed",
            `The stored image exceeds the ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)} MB limit. Use Change Image (🖼) to replace it with a smaller graphic.`,
          );
        }
        return {
          buffer: contents as Buffer,
          contentType: (metadata.contentType as string) || "image/jpeg",
        };
      } catch (err) {
        if (err instanceof ImageRetrievalError) throw err;
        if (err instanceof ObjectNotFoundError) {
          throw new ImageRetrievalError(
            "image_not_found",
            `The uploaded image no longer exists in Orbit storage (${imageUrl}). Use Change Image (🖼) to replace the graphic.`,
          );
        }
        lastErr = err;
        if (!isTransientStorageError(err)) break;
        if (attempt < delays.length) await sleep(delays[attempt]);
      }
    }
    throw new ImageRetrievalError(
      "image_fetch_failed",
      `Reading the uploaded image from Orbit storage failed after ${delays.length + 1} attempts (${imageUrl}): ${(lastErr as any)?.message ?? lastErr}. Use Retry to try again.`,
      true,
    );
  }

  const filePath = publicObjectPath(imageUrl);

  if (filePath) {
    const storage = opts.storage ?? new ObjectStorageService();
    let lastErr: unknown = null;
    for (let attempt = 0; attempt <= delays.length; attempt++) {
      try {
        const file = await storage.searchPublicObject(filePath);
        if (!file) {
          throw new ImageRetrievalError(
            "image_not_found",
            `The image no longer exists in Orbit storage (${imageUrl}). Use Change Image (🖼) to replace the graphic.`,
          );
        }
        const [metadata] = await file.getMetadata();
        const declaredSize = Number((metadata as any).size);
        if (Number.isFinite(declaredSize) && declaredSize > MAX_IMAGE_BYTES) {
          throw new ImageRetrievalError(
            "image_fetch_failed",
            `The stored image is ${Math.round(declaredSize / 1024 / 1024)} MB — over the ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)} MB limit. Use Change Image (🖼) to replace it with a smaller graphic.`,
          );
        }
        const [contents] = await file.download();
        if ((contents as Buffer).byteLength > MAX_IMAGE_BYTES) {
          throw new ImageRetrievalError(
            "image_fetch_failed",
            `The stored image exceeds the ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)} MB limit. Use Change Image (🖼) to replace it with a smaller graphic.`,
          );
        }
        return {
          buffer: contents as Buffer,
          contentType: (metadata.contentType as string) || "image/jpeg",
        };
      } catch (err) {
        if (err instanceof ImageRetrievalError) throw err;
        lastErr = err;
        if (!isTransientStorageError(err)) break;
        if (attempt < delays.length) await sleep(delays[attempt]);
      }
    }
    throw new ImageRetrievalError(
      "image_fetch_failed",
      `Reading the image from Orbit storage failed after ${delays.length + 1} attempts (${imageUrl}): ${(lastErr as any)?.message ?? lastErr}. Use Retry to try again.`,
      true,
    );
  }

  // External URL — HTTP fetch with retries on transient failures.
  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      const resp = await guardedFetch(imageUrl);
      if (resp.ok) {
        return {
          buffer: await readBodyCapped(resp, imageUrl),
          contentType: resp.headers.get("content-type") ?? "image/jpeg",
        };
      }
      if (resp.status === 404 || resp.status === 410) {
        throw new ImageRetrievalError(
          "image_not_found",
          `The image no longer exists at ${imageUrl} (HTTP ${resp.status}). Use Change Image (🖼) to replace the graphic.`,
        );
      }
      if (resp.status === 401 || resp.status === 403) {
        throw new ImageRetrievalError(
          "image_forbidden",
          `The image at ${imageUrl} is behind an auth-gated path (HTTP ${resp.status}). Use Change Image (🖼) to pick or re-upload the graphic so it lands in public storage.`,
        );
      }
      // Other 4xx are permanent too — retrying won't change the answer.
      if (resp.status >= 400 && resp.status < 500 && resp.status !== 429) {
        throw new ImageRetrievalError(
          "image_fetch_failed",
          `Image fetch failed with HTTP ${resp.status} for ${imageUrl}. Use Change Image (🖼) to replace the graphic.`,
        );
      }
      // 5xx / 429 — transient, retry.
      lastErr = new Error(`HTTP ${resp.status}`);
    } catch (err) {
      // Permanent typed errors (404, SSRF-guard violations, …) propagate
      // immediately; transient ones (e.g. DNS blip) keep retrying.
      if (err instanceof ImageRetrievalError && !err.transient) throw err;
      lastErr = err; // network error / timeout — transient
    }
    if (attempt < delays.length) await sleep(delays[attempt]);
  }
  throw new ImageRetrievalError(
    "image_fetch_failed",
    `Image fetch failed after ${delays.length + 1} attempts (${imageUrl}): ${(lastErr as any)?.message ?? lastErr}. Use Retry to try again.`,
    true,
  );
}

/**
 * Pre-flight check: does this image resolve right now?
 * Never throws — returns a structured result for the worker's preflight sweep.
 */
export async function checkImageResolvable(
  imageUrl: string,
  opts: { retryDelaysMs?: number[]; storage?: ObjectStorageService } = {},
): Promise<{ ok: boolean; code?: ImageErrorCode; message?: string; transient?: boolean }> {
  // Private-upload branch: /objects/uploads/... — check via getObjectEntityFile.
  const entityPath = objectEntityPath(imageUrl);
  if (entityPath) {
    try {
      const storage = opts.storage ?? new ObjectStorageService();
      await storage.getObjectEntityFile(entityPath); // throws ObjectNotFoundError if missing
      return { ok: true };
    } catch (err: any) {
      if (err instanceof ObjectNotFoundError) {
        return { ok: false, code: "image_not_found", message: `Uploaded image missing from Orbit storage: ${imageUrl}` };
      }
      // Storage hiccup — don't flag, let preflight retry next sweep.
      return { ok: false, code: "image_fetch_failed", message: err?.message ?? String(err), transient: true };
    }
  }

  const filePath = publicObjectPath(imageUrl);
  if (filePath) {
    try {
      const storage = opts.storage ?? new ObjectStorageService();
      const file = await storage.searchPublicObject(filePath);
      if (!file) {
        return {
          ok: false,
          code: "image_not_found",
          message: `Image missing from Orbit storage: ${imageUrl}`,
        };
      }
      return { ok: true };
    } catch (err: any) {
      // Storage hiccup during preflight — don't flag the post, just skip.
      return { ok: false, code: "image_fetch_failed", message: err?.message ?? String(err), transient: true };
    }
  }
  // SharePoint URLs need the authenticated Graph branch — assume ok here.
  if (/sharepoint\.com\/contentstorage\//i.test(imageUrl)) return { ok: true };
  try {
    const { buffer } = await fetchImageBytes(imageUrl, { retryDelaysMs: opts.retryDelaysMs ?? [500] });
    if (buffer.length === 0) {
      return { ok: false, code: "image_fetch_failed", message: `Image at ${imageUrl} is empty.` };
    }
    return { ok: true };
  } catch (err) {
    if (err instanceof ImageRetrievalError) {
      return { ok: false, code: err.code, message: err.message, transient: err.transient };
    }
    return { ok: false, code: "image_fetch_failed", message: (err as any)?.message ?? String(err), transient: true };
  }
}
