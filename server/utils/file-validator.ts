import { UploadedFile } from "express-fileupload";

export interface FileValidationResult {
  isValid: boolean;
  error?: string;
  sanitizedFilename?: string;
}

export interface FileValidationOptions {
  maxSizeBytes?: number;
  allowedMimeTypes?: string[];
  allowedExtensions?: string[];
}

const DEFAULT_MAX_SIZE = 10 * 1024 * 1024; // 10MB

const DOCUMENT_MIME_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "text/plain",
];

const DOCUMENT_EXTENSIONS = [".pdf", ".docx", ".doc", ".txt"];

const IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/svg+xml",
];

const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg"];

const DANGEROUS_PATTERNS = [
  /<script[\s\S]*?>[\s\S]*?<\/script>/gi,
  /javascript:/gi,
  /data:text\/html/gi,
  /vbscript:/gi,
  /onload\s*=/gi,
  /onerror\s*=/gi,
  /onclick\s*=/gi,
  /onmouseover\s*=/gi,
];

const PDF_MAGIC_BYTES = Buffer.from([0x25, 0x50, 0x44, 0x46]); // %PDF
const DOCX_MAGIC_BYTES = Buffer.from([0x50, 0x4b, 0x03, 0x04]); // PK (ZIP format)

export function sanitizeFilename(filename: string): string {
  const sanitized = filename
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/\.{2,}/g, ".")
    .replace(/^\.+|\.+$/g, "")
    .substring(0, 255);

  if (!sanitized || sanitized === "_") {
    return `file_${Date.now()}`;
  }

  return sanitized;
}

function getFileExtension(filename: string): string {
  const lastDot = filename.lastIndexOf(".");
  if (lastDot === -1) return "";
  return filename.substring(lastDot).toLowerCase();
}

function validateMagicBytes(buffer: Buffer, mimeType: string): boolean {
  if (buffer.length < 4) {
    return false;
  }

  const firstBytes = buffer.slice(0, 4);

  if (mimeType === "application/pdf") {
    return firstBytes.compare(PDF_MAGIC_BYTES) === 0;
  }

  if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    return firstBytes.compare(DOCX_MAGIC_BYTES) === 0;
  }

  if (mimeType === "image/jpeg") {
    return buffer[0] === 0xFF && buffer[1] === 0xD8;
  }

  if (mimeType === "image/png") {
    return buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47;
  }

  if (mimeType === "image/gif") {
    return buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46;
  }

  return true;
}

function checkForDangerousContent(content: string): boolean {
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(content)) {
      return true;
    }
  }
  return false;
}

export function validateUploadedFile(
  file: UploadedFile,
  options: FileValidationOptions = {}
): FileValidationResult {
  const {
    maxSizeBytes = DEFAULT_MAX_SIZE,
    allowedMimeTypes = DOCUMENT_MIME_TYPES,
    allowedExtensions = DOCUMENT_EXTENSIONS,
  } = options;

  if (!file) {
    return { isValid: false, error: "No file provided" };
  }

  if (!file.name || typeof file.name !== "string") {
    return { isValid: false, error: "Invalid filename" };
  }

  if (file.size > maxSizeBytes) {
    const maxSizeMB = Math.round(maxSizeBytes / (1024 * 1024));
    return { isValid: false, error: `File size exceeds maximum allowed (${maxSizeMB}MB)` };
  }

  if (file.size === 0) {
    return { isValid: false, error: "File is empty" };
  }

  const extension = getFileExtension(file.name);
  if (!allowedExtensions.includes(extension)) {
    return { 
      isValid: false, 
      error: `File type not allowed. Allowed types: ${allowedExtensions.join(", ")}` 
    };
  }

  if (!allowedMimeTypes.includes(file.mimetype)) {
    return { 
      isValid: false, 
      error: `File MIME type not allowed. Allowed types: ${allowedMimeTypes.join(", ")}` 
    };
  }

  if (!validateMagicBytes(file.data, file.mimetype)) {
    return { 
      isValid: false, 
      error: "File content does not match its declared type" 
    };
  }

  if (file.mimetype === "text/plain" || file.mimetype.includes("xml")) {
    const content = file.data.toString("utf-8");
    if (checkForDangerousContent(content)) {
      return { 
        isValid: false, 
        error: "File contains potentially dangerous content" 
      };
    }
  }

  const sanitizedFilename = sanitizeFilename(file.name);

  return { isValid: true, sanitizedFilename };
}

export function validateDocumentUpload(file: UploadedFile): FileValidationResult {
  return validateUploadedFile(file, {
    maxSizeBytes: 10 * 1024 * 1024, // 10MB
    allowedMimeTypes: DOCUMENT_MIME_TYPES,
    allowedExtensions: DOCUMENT_EXTENSIONS,
  });
}

export function validateImageUpload(file: UploadedFile): FileValidationResult {
  return validateUploadedFile(file, {
    maxSizeBytes: 5 * 1024 * 1024, // 5MB
    allowedMimeTypes: IMAGE_MIME_TYPES,
    allowedExtensions: IMAGE_EXTENSIONS,
  });
}

export { DOCUMENT_MIME_TYPES, DOCUMENT_EXTENSIONS, IMAGE_MIME_TYPES, IMAGE_EXTENSIONS };
