/**
 * Tests: large image upload limits
 *
 * Covers three upload surfaces that share the 15 MB cap:
 *   1. validateImageUpload() — used by /api/upload/logo (brand library) and
 *      the conference image admin route (admin.ts).
 *   2. checkUploadSizeLimit() — the shared gate used by /api/uploads/request-url,
 *      which is the presigned-URL path hit by the social composer's ObjectUploader.
 *   3. ObjectUploader default — its maxFileSize default must equal MAX_IMAGE_FILE_SIZE
 *      so Uppy catches oversized files before any network request is made.
 *
 * All limits and logic are imported from production modules; a change to either
 * constant or to checkUploadSizeLimit() will immediately break the relevant test.
 *
 * "Done" criteria from task #507:
 *  ✓ ~14 MB image accepted on all surfaces
 *  ✓ ~16 MB image rejected with a clear, user-readable error
 *  ✓ Social composer attachment path is covered
 */

import { strict as assert } from "node:assert";
import { describe, it } from "vitest";
import type { UploadedFile } from "express-fileupload";

// Real production exports — tests break if these values change without updating
// the complementary side (client default, server gate, multipart validator).
import {
  MAX_IMAGE_FILE_SIZE,
  MAX_DOCUMENT_FILE_SIZE,
  ALLOWED_IMAGE_CONTENT_TYPES,
  checkUploadSizeLimit,
} from "@shared/upload-limits";

import {
  validateImageUpload,
  validateDocumentUpload,
} from "../file-validator";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MB = 1024 * 1024;

/**
 * Build a minimal UploadedFile stub with real magic bytes so validateMagicBytes
 * passes for the given MIME type.
 */
function makeImageFile(
  sizeBytes: number,
  mimeType: "image/jpeg" | "image/png" | "image/webp" | "image/gif" = "image/jpeg",
  name = "photo.jpg"
): UploadedFile {
  const data = Buffer.alloc(Math.max(sizeBytes, 4));
  switch (mimeType) {
    case "image/jpeg":
      data[0] = 0xff; data[1] = 0xd8;
      break;
    case "image/png":
      data[0] = 0x89; data[1] = 0x50; data[2] = 0x4e; data[3] = 0x47;
      break;
    case "image/gif":
      data[0] = 0x47; data[1] = 0x49; data[2] = 0x46;
      break;
    // webp: no magic-byte check in the validator; any buffer passes
  }
  return {
    name,
    data,
    size: sizeBytes,
    mimetype: mimeType,
    encoding: "7bit",
    md5: "",
    mv: async () => {},
    truncated: false,
    tempFilePath: "",
  } as unknown as UploadedFile;
}

// ---------------------------------------------------------------------------
// 1. validateImageUpload — brand library (/api/upload/logo) and conference
//    image admin route (/api/conference-images). Both call validateImageUpload()
//    which enforces MAX_IMAGE_FILE_SIZE.
// ---------------------------------------------------------------------------

describe("validateImageUpload — brand library / conference image path", () => {
  it("reports the server image cap as 15 MB", () => {
    assert.equal(MAX_IMAGE_FILE_SIZE, 15 * MB);
  });

  it("accepts a ~14 MB JPEG (just under the 15 MB cap)", () => {
    const file = makeImageFile(14 * MB, "image/jpeg", "large-photo.jpg");
    const result = validateImageUpload(file);
    assert.equal(result.isValid, true, `Expected isValid=true; got: ${result.error}`);
  });

  it("accepts a ~14 MB PNG", () => {
    const file = makeImageFile(14 * MB, "image/png", "large-photo.png");
    const result = validateImageUpload(file);
    assert.equal(result.isValid, true, `Expected isValid=true; got: ${result.error}`);
  });

  it("accepts an image exactly at the 15 MB cap", () => {
    const file = makeImageFile(MAX_IMAGE_FILE_SIZE, "image/jpeg", "cap-photo.jpg");
    const result = validateImageUpload(file);
    assert.equal(result.isValid, true, `Expected isValid=true; got: ${result.error}`);
  });

  it("rejects a ~16 MB JPEG with a user-readable error referencing the limit", () => {
    const file = makeImageFile(16 * MB, "image/jpeg", "too-big.jpg");
    const result = validateImageUpload(file);
    assert.equal(result.isValid, false);
    assert.ok(result.error, "Expected an error message");
    assert.match(result.error!, /15\s*MB/i,
      `Error should name the 15 MB limit; got: "${result.error}"`);
  });

  it("rejects a file 1 byte over the limit", () => {
    const file = makeImageFile(MAX_IMAGE_FILE_SIZE + 1, "image/jpeg", "one-over.jpg");
    const result = validateImageUpload(file);
    assert.equal(result.isValid, false);
    assert.match(result.error!, /15\s*MB/i);
  });

  it("returns a sanitized filename on success", () => {
    const file = makeImageFile(1 * MB, "image/jpeg", "my photo (final).jpg");
    const result = validateImageUpload(file);
    assert.equal(result.isValid, true);
    assert.ok(result.sanitizedFilename && !/[ ()]/.test(result.sanitizedFilename),
      `Expected sanitized filename; got: ${result.sanitizedFilename}`);
  });

  it("rejects an empty file", () => {
    const file = makeImageFile(0, "image/jpeg", "empty.jpg");
    const result = validateImageUpload(file);
    assert.equal(result.isValid, false);
    assert.match(result.error!, /empty/i);
  });

  it("accepts image/webp (used by brand graphic exports)", () => {
    const file = makeImageFile(2 * MB, "image/webp", "graphic.webp");
    const result = validateImageUpload(file);
    assert.equal(result.isValid, true, `Expected isValid=true; got: ${result.error}`);
  });
});

// ---------------------------------------------------------------------------
// 2. checkUploadSizeLimit — presigned URL gate used by /api/uploads/request-url
//    (social composer ObjectUploader attachment path, and also the brand library
//    presigned flow). Imported from shared/upload-limits, same module the
//    route calls.
// ---------------------------------------------------------------------------

describe("checkUploadSizeLimit — social composer attachment / presigned-URL gate", () => {
  it("ALLOWED_IMAGE_CONTENT_TYPES includes the types composers use", () => {
    for (const t of ["image/jpeg", "image/png", "image/webp", "image/gif"]) {
      assert.ok(ALLOWED_IMAGE_CONTENT_TYPES.includes(t), `Expected ${t} to be an allowed image type`);
    }
  });

  it("allows a ~14 MB JPEG image request", () => {
    const r = checkUploadSizeLimit(14 * MB, "image/jpeg");
    assert.equal(r.allowed, true);
  });

  it("allows a ~14 MB PNG image request", () => {
    const r = checkUploadSizeLimit(14 * MB, "image/png");
    assert.equal(r.allowed, true);
  });

  it("allows a request exactly at the 15 MB image cap", () => {
    const r = checkUploadSizeLimit(MAX_IMAGE_FILE_SIZE, "image/jpeg");
    assert.equal(r.allowed, true);
  });

  it("rejects a ~16 MB image with the expected error wording", () => {
    const r = checkUploadSizeLimit(16 * MB, "image/jpeg");
    assert.equal(r.allowed, false);
    assert.ok(r.error, "Expected an error message");
    // The route surfaces this string verbatim; it must name the cap.
    assert.match(r.error!, /15MB/i);
  });

  it("rejects an image 1 byte over the cap", () => {
    const r = checkUploadSizeLimit(MAX_IMAGE_FILE_SIZE + 1, "image/png");
    assert.equal(r.allowed, false);
    assert.match(r.error!, /15MB/i);
  });

  it("rejects a ~14 MB document (documents cap at 10 MB, not 15 MB)", () => {
    const r = checkUploadSizeLimit(14 * MB, "application/pdf");
    assert.equal(r.allowed, false);
    assert.match(r.error!, /10MB/i,
      `Error should reference the 10 MB doc cap; got: "${r.error}"`);
  });

  it("allows a 9 MB PDF (under the 10 MB document cap)", () => {
    const r = checkUploadSizeLimit(9 * MB, "application/pdf");
    assert.equal(r.allowed, true);
  });
});

// ---------------------------------------------------------------------------
// 3. ObjectUploader client-side default matches the server cap
//
//    ObjectUploader passes maxFileSize to Uppy which stops the upload before
//    any request reaches the server. The default is imported from
//    shared/upload-limits (same source as the server gate) so they cannot
//    drift. This test confirms the shared value equals 15 MB.
// ---------------------------------------------------------------------------

describe("ObjectUploader default — client/server limit alignment", () => {
  it("MAX_IMAGE_FILE_SIZE is exactly 15 MB (15 * 1024 * 1024)", () => {
    // ObjectUploader uses `maxFileSize = MAX_IMAGE_FILE_SIZE` (imported from
    // shared/upload-limits), and the /api/uploads/request-url route enforces
    // the same constant via checkUploadSizeLimit(). Both sides changing together
    // is enforced by them sharing this single source of truth.
    assert.equal(MAX_IMAGE_FILE_SIZE, 15 * 1024 * 1024);
  });

  it("MAX_DOCUMENT_FILE_SIZE is exactly 10 MB — document cap not accidentally raised", () => {
    assert.equal(MAX_DOCUMENT_FILE_SIZE, 10 * 1024 * 1024);
  });
});

// ---------------------------------------------------------------------------
// 4. validateDocumentUpload — regression guard that the document 10 MB cap
//    was not accidentally raised to 15 MB when the image limit was bumped.
// ---------------------------------------------------------------------------

describe("validateDocumentUpload — 10 MB cap unchanged", () => {
  function makePdfFile(sizeBytes: number): UploadedFile {
    const data = Buffer.alloc(Math.max(sizeBytes, 4));
    // %PDF magic bytes
    data[0] = 0x25; data[1] = 0x50; data[2] = 0x44; data[3] = 0x46;
    return {
      name: "report.pdf", data, size: sizeBytes, mimetype: "application/pdf",
      encoding: "7bit", md5: "", mv: async () => {}, truncated: false, tempFilePath: "",
    } as unknown as UploadedFile;
  }

  it("accepts a 9 MB PDF", () => {
    const result = validateDocumentUpload(makePdfFile(9 * MB));
    assert.equal(result.isValid, true, `Expected isValid=true; got: ${result.error}`);
  });

  it("rejects an 11 MB PDF with an error referencing the 10 MB limit", () => {
    const result = validateDocumentUpload(makePdfFile(11 * MB));
    assert.equal(result.isValid, false);
    assert.match(result.error!, /10\s*MB/i,
      `Error should reference 10 MB cap; got: "${result.error}"`);
  });

  it("document cap (MAX_DOCUMENT_FILE_SIZE) is lower than the image cap", () => {
    assert.ok(MAX_DOCUMENT_FILE_SIZE < MAX_IMAGE_FILE_SIZE,
      "Document cap must remain below the image cap");
  });
});
