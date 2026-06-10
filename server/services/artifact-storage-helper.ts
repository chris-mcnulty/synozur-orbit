/**
 * Artifact storage helper (WS6).
 *
 * One place to persist finished marketing output — generated Word docs, CSV
 * exports, and post graphics — so they're retained, secure, and visible to the
 * company. Prefers SharePoint Embedded (SPE) when the tenant has it enabled,
 * and SILENTLY falls back to object storage when SPE is disabled, unconfigured,
 * or errors. Storage is best-effort: callers may stream the artifact to the
 * client regardless of where (or whether) it persisted.
 */

import { randomUUID } from "crypto";
import { storage } from "../storage";
import {
  objectStorageClient,
  ObjectStorageService,
} from "../replit_integrations/object_storage/objectStorage";

const objectStorageService = new ObjectStorageService();
const PUBLIC_SERVE_PREFIX = "/public-objects/";
const ARTIFACT_PREFIX = "marketing-artifacts";

export type ArtifactKind = "docx" | "csv" | "image" | "pdf";

export interface StoreArtifactParams {
  tenantDomain: string;
  buffer: Buffer;
  filename: string;
  mimeType: string;
  kind: ArtifactKind;
  marketId?: string | null;
  createdByUserId: string;
  /** Conference/event context, for SPE metadata. */
  competitorId?: string;
}

export interface StoreArtifactResult {
  /** A URL the app can use: an SPE web URL, or a public object path. */
  url: string;
  fileSize: number;
  storedIn: "spe" | "object";
  speFileId?: string;
}

function splitObjectPath(fullPath: string): { bucketName: string; objectName: string } {
  const parts = fullPath.startsWith("/") ? fullPath.slice(1).split("/") : fullPath.split("/");
  return { bucketName: parts[0], objectName: parts.slice(1).join("/") };
}

function extFor(kind: ArtifactKind, filename: string): string {
  const fromName = filename.includes(".") ? filename.split(".").pop()!.toLowerCase() : "";
  if (fromName) return fromName;
  switch (kind) {
    case "docx": return "docx";
    case "csv": return "csv";
    case "pdf": return "pdf";
    case "image": return "png";
  }
}

/** Persist a buffer to the public object bucket and return its Orbit path. */
async function saveToObjectStorage(
  buffer: Buffer,
  mimeType: string,
  ext: string,
): Promise<StoreArtifactResult> {
  const publicPaths = objectStorageService.getPublicObjectSearchPaths();
  const { bucketName, objectName: publicPrefix } = splitObjectPath(publicPaths[0]);
  const objectId = `${randomUUID()}.${ext}`;
  const objectName = `${publicPrefix.replace(/\/$/, "")}/${ARTIFACT_PREFIX}/${objectId}`;
  await objectStorageClient.bucket(bucketName).file(objectName).save(buffer, {
    metadata: { contentType: mimeType },
  });
  return {
    url: `${PUBLIC_SERVE_PREFIX}${ARTIFACT_PREFIX}/${objectId}`,
    fileSize: buffer.length,
    storedIn: "object",
  };
}

/**
 * Store a finished artifact. SPE first (when enabled for the tenant), with a
 * silent fallback to object storage. Throws only if BOTH paths fail.
 */
export async function storeArtifact(params: StoreArtifactParams): Promise<StoreArtifactResult> {
  const ext = extFor(params.kind, params.filename);

  // Try SPE when the tenant has opted in.
  try {
    const tenant = await storage.getTenantByDomain(params.tenantDomain);
    if (tenant?.speStorageEnabled) {
      const { sharepointFileStorage } = await import("./sharepoint-file-storage.js");
      const stored = await sharepointFileStorage.storeFile(
        params.buffer,
        params.filename,
        params.mimeType,
        {
          documentType: "marketing_artifact",
          scope: "tenant",
          tenantDomain: params.tenantDomain,
          marketId: params.marketId || undefined,
          competitorId: params.competitorId,
          createdByUserId: params.createdByUserId,
          fileType: ext,
          originalFileName: params.filename,
        },
        params.createdByUserId,
        undefined,
        tenant.id,
      );
      return {
        url: stored.webUrl,
        fileSize: stored.size,
        storedIn: "spe",
        speFileId: stored.id,
      };
    }
  } catch (err) {
    // Silent fallback: SPE attempted but unavailable/errored — log and continue.
    console.error(
      `[Artifact Storage] SPE store failed for ${params.filename}; falling back to object storage:`,
      (err as Error).message,
    );
  }

  return saveToObjectStorage(params.buffer, params.mimeType, ext);
}

/**
 * Best-effort archival that never throws — for callers that already have a
 * working public URL (e.g. post images stored in object storage) but also want
 * a vetted SPE copy when enabled. Returns the SPE file id when it lands there.
 */
export async function archiveArtifactToSpe(
  params: StoreArtifactParams,
): Promise<{ speFileId: string } | null> {
  try {
    const tenant = await storage.getTenantByDomain(params.tenantDomain);
    if (!tenant?.speStorageEnabled) return null;
    const { sharepointFileStorage } = await import("./sharepoint-file-storage.js");
    const stored = await sharepointFileStorage.storeFile(
      params.buffer,
      params.filename,
      params.mimeType,
      {
        documentType: "marketing_artifact",
        scope: "tenant",
        tenantDomain: params.tenantDomain,
        marketId: params.marketId || undefined,
        competitorId: params.competitorId,
        createdByUserId: params.createdByUserId,
        fileType: extFor(params.kind, params.filename),
        originalFileName: params.filename,
      },
      params.createdByUserId,
      undefined,
      tenant.id,
    );
    return { speFileId: stored.id };
  } catch (err) {
    console.error(`[Artifact Storage] SPE archival failed for ${params.filename}:`, (err as Error).message);
    return null;
  }
}
