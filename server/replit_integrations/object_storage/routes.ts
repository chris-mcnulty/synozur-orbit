import type { Express } from "express";
import { ObjectStorageService, ObjectNotFoundError } from "./objectStorage";
import { generateThumbnail, snapWidth, isResizableContentType } from "../../services/thumbnail-service";

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

const ALLOWED_CONTENT_TYPES = [...ALLOWED_DOCUMENT_TYPES, ...ALLOWED_IMAGE_TYPES];

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

