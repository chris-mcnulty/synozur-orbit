/**
 * Upload size limits and content-type policy — shared by client and server.
 *
 * Keeping the constants and gate logic here means the client-side Uppy
 * restriction (ObjectUploader) and the server-side presigned-URL guard
 * (/api/uploads/request-url) can never silently diverge.
 */

/** Maximum bytes allowed for image uploads (brand library, conference images, social composer). */
export const MAX_IMAGE_FILE_SIZE = 15 * 1024 * 1024; // 15 MB

/** Maximum bytes allowed for document uploads (PDFs, DOCX, etc.). */
export const MAX_DOCUMENT_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

/** MIME types that are treated as images for the purposes of the higher size cap. */
export const ALLOWED_IMAGE_CONTENT_TYPES: readonly string[] = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "image/bmp",
  "image/tiff",
];

export interface UploadSizeCheckResult {
  allowed: boolean;
  /** Present when allowed is false. Human-readable; safe to surface to the user. */
  error?: string;
}

/**
 * Determine whether a file of the given size and content-type is within the
 * server-enforced upload size limit.
 *
 * Used by:
 *  - POST /api/uploads/request-url (presigned URL gate — composer, brand library)
 *  - ObjectUploader component (Uppy maxFileSize prop — early client-side rejection)
 *  - Tests confirming both surfaces stay in sync
 */
export function checkUploadSizeLimit(
  sizeBytes: number,
  contentType: string
): UploadSizeCheckResult {
  const isImage = ALLOWED_IMAGE_CONTENT_TYPES.includes(contentType);
  const maxBytes = isImage ? MAX_IMAGE_FILE_SIZE : MAX_DOCUMENT_FILE_SIZE;
  if (sizeBytes > maxBytes) {
    const maxMB = maxBytes / (1024 * 1024);
    return {
      allowed: false,
      error: `File too large. Maximum size is ${maxMB}MB.`,
    };
  }
  return { allowed: true };
}
