import type { Express } from "express";
import { ObjectStorageService, ObjectNotFoundError } from "./objectStorage";
import { generateThumbnail, snapWidth, isResizableContentType } from "../../services/thumbnail-service";
import { Readable } from "stream";
import dns from "dns";

// ─── SSRF helpers ─────────────────────────────────────────────────────────────

/**
 * Returns true when an IPv4 address string falls in any private, loopback,
 * link-local, CGNAT, documentation, multicast, or otherwise non-routable range.
 */
function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return true;
  const [a, b, c] = parts;
  return (
    a === 0 ||                                     // 0.0.0.0/8     this-network
    a === 10 ||                                    // 10.0.0.0/8    private
    a === 127 ||                                   // 127.0.0.0/8   loopback
    (a === 100 && b >= 64 && b <= 127) ||          // 100.64.0.0/10 CGNAT
    (a === 169 && b === 254) ||                    // 169.254.0.0/16 link-local
    (a === 172 && b >= 16 && b <= 31) ||           // 172.16.0.0/12 private
    (a === 192 && b === 0 && c === 0) ||           // 192.0.0.0/24  IETF protocol
    (a === 192 && b === 0 && c === 2) ||           // 192.0.2.0/24  TEST-NET-1
    (a === 192 && b === 88 && c === 99) ||         // 192.88.99.0/24 formerly 6to4
    (a === 192 && b === 168) ||                    // 192.168.0.0/16 private
    (a === 198 && b >= 18 && b <= 19) ||           // 198.18.0.0/15 benchmarking
    (a === 198 && b === 51 && c === 100) ||        // 198.51.100.0/24 TEST-NET-2
    (a === 203 && b === 0 && c === 113) ||         // 203.0.113.0/24 TEST-NET-3
    a >= 224                                       // 224+           multicast + reserved
  );
}

/**
 * Returns true when an IPv6 address string falls in any private/reserved range.
 * Also catches IPv4-mapped addresses by extracting the embedded IPv4 part.
 */
function isPrivateIPv6(ip: string): boolean {
  const addr = ip.toLowerCase().replace(/^\[|\]$/, "");
  if (addr === "::1" || addr === "::") return true;
  // IPv4-mapped ::ffff:a.b.c.d or ::ffff:0xABCDEF — check embedded IPv4
  const v4mapped = addr.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (v4mapped) return isPrivateIPv4(v4mapped[1]);
  const v4hex = addr.match(/^::ffff:([0-9a-f]{4}):([0-9a-f]{4})$/);
  if (v4hex) {
    const toOctets = (h: string) => [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2), 16)];
    const [a, b] = toOctets(v4hex[1]);
    const [c, d] = toOctets(v4hex[2]);
    return isPrivateIPv4(`${a}.${b}.${c}.${d}`);
  }
  return (
    addr.startsWith("fe80:") ||   // link-local
    addr.startsWith("fc") ||      // unique local
    addr.startsWith("fd") ||      // unique local
    addr.startsWith("ff") ||      // multicast
    addr.startsWith("::ffff:") || // IPv4-mapped (other forms)
    addr.startsWith("64:ff9b:") || // NAT64
    addr.startsWith("2001:db8:") // documentation
  );
}

/**
 * Resolves `hostname` via DNS and returns true if ANY resolved address is
 * private/reserved. Fails closed (returns true) on resolution errors.
 */
async function hostnameResolvesToPrivate(hostname: string): Promise<boolean> {
  // Strip brackets from IPv6 literals
  const bare = hostname.replace(/^\[|\]$/, "");
  // If the hostname is already an IP literal, check it directly without DNS
  if (/^\d+\.\d+\.\d+\.\d+$/.test(bare)) return isPrivateIPv4(bare);
  if (/^[0-9a-fA-F:]+$/.test(bare) && bare.includes(":")) return isPrivateIPv6(bare);

  try {
    const results = await dns.promises.lookup(hostname, { all: true, family: 0 });
    for (const { address, family } of results) {
      if (family === 4 && isPrivateIPv4(address)) return true;
      if (family === 6 && isPrivateIPv6(address)) return true;
    }
    return false;
  } catch {
    return true; // DNS failure — fail closed
  }
}

/** Returns true only if the URL has a safe scheme AND its hostname resolves to a public IP. */
async function isSafeExternalUrl(raw: string): Promise<{ safe: boolean; parsed?: URL }> {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { safe: false };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return { safe: false };
  const isPrivate = await hostnameResolvesToPrivate(parsed.hostname);
  return { safe: !isPrivate, parsed };
}

const ALLOWED_DOCUMENT_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "text/plain",
];

const ALLOWED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/svg+xml",
];

const ALLOWED_FONT_TYPES = [
  "font/ttf",
  "font/otf",
  "font/woff",
  "font/woff2",
  "application/font-woff",
  "application/font-woff2",
  "application/x-font-ttf",
  "application/x-font-otf",
  "application/octet-stream", // browsers often report font files with this generic type
];

const ALLOWED_CONTENT_TYPES = [...ALLOWED_DOCUMENT_TYPES, ...ALLOWED_IMAGE_TYPES, ...ALLOWED_FONT_TYPES];

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

/**
 * Register object storage routes for file uploads.
 *
 * This provides example routes for the presigned URL upload flow:
 * 1. POST /api/uploads/request-url - Get a presigned URL for uploading
 * 2. The client then uploads directly to the presigned URL
 */
export function registerObjectStorageRoutes(app: Express): void {
  const objectStorageService = new ObjectStorageService();

  /**
   * Request a presigned URL for file upload.
   * Requires authentication.
   *
   * Request body (JSON):
   * {
   *   "name": "filename.jpg",
   *   "size": 12345,
   *   "contentType": "image/jpeg"
   * }
   *
   * Response:
   * {
   *   "uploadURL": "https://storage.googleapis.com/...",
   *   "objectPath": "/objects/uploads/uuid"
   * }
   */
  app.post("/api/uploads/request-url", async (req, res) => {
    try {
      if (!req.session?.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const { name, size, contentType } = req.body;

      if (!name) {
        return res.status(400).json({
          error: "Missing required field: name",
        });
      }

      // Validate content type for security
      if (contentType && !ALLOWED_CONTENT_TYPES.includes(contentType)) {
        return res.status(400).json({
          error: `File type not allowed. Allowed types: PDF, DOCX, DOC, TXT, and common image formats.`,
        });
      }

      // Validate file size
      if (size && size > MAX_FILE_SIZE) {
        return res.status(400).json({
          error: `File too large. Maximum size is ${MAX_FILE_SIZE / (1024 * 1024)}MB.`,
        });
      }

      // Sanitize filename to prevent path traversal
      const sanitizedName = name
        .replace(/[^a-zA-Z0-9._-]/g, "_")
        .replace(/\.{2,}/g, ".")
        .substring(0, 255);

      const uploadURL = await objectStorageService.getObjectEntityUploadURL();

      // Extract object path from the presigned URL for later reference
      const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);

      res.json({
        uploadURL,
        objectPath,
        // Echo back the metadata for client convenience
        metadata: { name: sanitizedName, size, contentType },
      });
    } catch (error) {
      console.error("Error generating upload URL:", error);
      res.status(500).json({ error: "Failed to generate upload URL" });
    }
  });

  /**
   * Proxy and resize an external (https/http) image through the same Sharp pipeline.
   * Requires authentication. Blocks private IP ranges to prevent SSRF.
   *
   * GET /api/thumbnails/ext?url=<encoded>&w=<width>
   */
  app.get("/api/thumbnails/ext", async (req, res) => {
    try {
      if (!req.session?.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const rawUrl = req.query.url as string | undefined;
      if (!rawUrl) {
        return res.status(400).json({ error: "Missing url parameter" });
      }

      // Validate URL and resolve DNS — reject private/reserved IP ranges (SSRF protection)
      const initialCheck = await isSafeExternalUrl(rawUrl);
      if (!initialCheck.safe || !initialCheck.parsed) {
        return res.status(400).json({ error: "URL is not allowed" });
      }

      const rawWidth = req.query.w as string | undefined;
      let requestedWidth = 320;
      if (rawWidth !== undefined) {
        requestedWidth = Number.parseInt(rawWidth, 10);
        if (Number.isNaN(requestedWidth)) {
          return res.status(400).json({ error: "Invalid width" });
        }
      }
      const width = snapWidth(requestedWidth);

      // Manually follow redirects so we can re-validate every hop's resolved IP.
      // This prevents redirect-based SSRF where the first URL is public but a
      // subsequent Location: header points to an internal address.
      const MAX_REDIRECTS = 5;
      let currentUrl = rawUrl;
      let fetchRes: Response | null = null;

      for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);
        let hopRes: Response;
        try {
          hopRes = await fetch(currentUrl, {
            signal: controller.signal,
            redirect: "manual",
          });
        } catch (err: any) {
          clearTimeout(timeout);
          if (err.name === "AbortError") {
            return res.status(504).json({ error: "Remote image fetch timed out" });
          }
          return res.status(502).json({ error: "Failed to fetch remote image" });
        }
        clearTimeout(timeout);

        if (hopRes.status >= 300 && hopRes.status < 400) {
          if (hop === MAX_REDIRECTS) {
            return res.status(502).json({ error: "Too many redirects" });
          }
          const location = hopRes.headers.get("location");
          if (!location) {
            return res.status(502).json({ error: "Redirect with no Location header" });
          }
          // Resolve relative redirects against the current URL
          const nextUrl = new URL(location, currentUrl).toString();
          // Re-validate the redirect target's resolved IP
          const nextCheck = await isSafeExternalUrl(nextUrl);
          if (!nextCheck.safe) {
            return res.status(400).json({ error: "Redirect target is not allowed" });
          }
          currentUrl = nextUrl;
          continue;
        }

        fetchRes = hopRes;
        break;
      }

      if (!fetchRes || !fetchRes.ok) {
        return res.status(502).json({ error: "Remote image returned non-OK status" });
      }

      const contentType = fetchRes.headers.get("content-type") || undefined;
      if (!isResizableContentType(contentType)) {
        // Not a resizable image — return 415 rather than proxying an unknown type
        return res.status(415).json({ error: "Remote URL is not a supported image type" });
      }

      // Collect response body and pipe through Sharp
      const arrayBuf = await fetchRes.arrayBuffer();
      const nodeBuffer = Buffer.from(arrayBuf);
      const nodeStream = Readable.from(nodeBuffer);

      const cacheKey = `ext:${rawUrl}`;
      const result = await generateThumbnail(nodeStream, contentType!, cacheKey, width);

      if (!result) {
        return res.status(415).json({ error: "Unable to resize remote image" });
      }

      res.set({
        "Content-Type": result.contentType,
        "Content-Length": String(result.buffer.length),
        "Cache-Control": "public, max-age=86400",
        Vary: "Accept",
      });
      return res.send(result.buffer);
    } catch (error) {
      console.error("Error proxying external thumbnail:", error);
      return res.status(500).json({ error: "Failed to generate thumbnail" });
    }
  });

  /**
   * Serve resized thumbnail images for asset list views.
   * Query params:
   *   w - desired width (snapped to nearest allowed size: 160, 320, 480, 640, 960)
   *
   * Returns WebP image with aggressive caching.  Falls through to the full
   * object endpoint for non-image types.
   *
   * GET /api/thumbnails/:objectPath(*)
   */
  app.get("/api/thumbnails/:objectPath(*)", async (req, res) => {
    try {
      if (!req.session?.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const rawWidth = req.query.w as string | undefined;
      let requestedWidth = 320;
      if (rawWidth !== undefined) {
        requestedWidth = Number.parseInt(rawWidth, 10);
        if (Number.isNaN(requestedWidth)) {
          return res.status(400).json({ error: "Invalid width" });
        }
      }
      const width = snapWidth(requestedWidth);

      // Reconstruct the /objects/ path the storage service expects
      const objectPath = `/objects/${req.params.objectPath}`;
      const objectFile = await objectStorageService.getObjectEntityFile(objectPath);

      // Check content type — only resize images
      const [metadata] = await objectFile.getMetadata();
      const contentType = metadata.contentType as string | undefined;
      if (!isResizableContentType(contentType)) {
        // Not an image we can resize — redirect to the original
        return res.redirect(`${objectPath}`);
      }

      const cacheKey = objectPath;
      const stream = objectFile.createReadStream();
      const result = await generateThumbnail(stream, contentType!, cacheKey, width);

      if (!result) {
        return res.redirect(`${objectPath}`);
      }

      res.set({
        "Content-Type": result.contentType,
        "Content-Length": String(result.buffer.length),
        "Cache-Control": "private, max-age=86400, immutable",
        Vary: "Accept",
      });
      return res.send(result.buffer);
    } catch (error) {
      console.error("Error generating thumbnail:", error);
      if (error instanceof ObjectNotFoundError) {
        return res.status(404).json({ error: "Object not found" });
      }
      return res.status(500).json({ error: "Failed to generate thumbnail" });
    }
  });

  /**
   * Serve PUBLIC objects with no authentication.
   *
   * Used for assets that must be fetchable by anonymous third parties — e.g.
   * conference/event promotion graphics whose URL is handed to external social
   * schedulers (SocialPilot, Hootsuite, Sprout). The underlying GCS bucket is
   * not anonymously readable, so those tools fetch through this Orbit route
   * instead of a raw storage.googleapis.com URL.
   *
   * Only objects that live under the configured PUBLIC search paths are served;
   * path traversal is rejected so the private space can't be reached.
   *
   * GET /public-objects/:objectPath(*)
   */
  app.get("/public-objects/:objectPath(*)", async (req, res) => {
    const filePath = req.params.objectPath;
    if (!filePath || filePath.includes("..")) {
      return res.status(400).json({ error: "Invalid path" });
    }
    try {
      const file = await objectStorageService.searchPublicObject(filePath);
      if (!file) {
        return res.status(404).json({ error: "Object not found" });
      }
      // Public assets — allow shared/long caching.
      await objectStorageService.downloadObject(file, res, 86400);
    } catch (error) {
      console.error("Error serving public object:", error);
      return res.status(500).json({ error: "Failed to serve object" });
    }
  });

  /**
   * Serve uploaded objects.
   * Requires authentication for private objects.
   *
   * GET /objects/:objectPath(*)
   */
  app.get("/objects/:objectPath(*)", async (req, res) => {
    try {
      if (!req.session?.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const objectFile = await objectStorageService.getObjectEntityFile(req.path);
      await objectStorageService.downloadObject(objectFile, res);
    } catch (error) {
      console.error("Error serving object:", error);
      if (error instanceof ObjectNotFoundError) {
        return res.status(404).json({ error: "Object not found" });
      }
      return res.status(500).json({ error: "Failed to serve object" });
    }
  });
}

