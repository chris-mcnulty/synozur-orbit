/**
 * SharePoint Embedded File Storage Service for Synozur Orbit
 *
 * Stores grounding documents (PDF, DOCX, DOC, TXT) and tenant images
 * (logos, favicons) in SharePoint Embedded containers instead of GCS.
 *
 * Folder structure inside each container:
 *   /grounding_documents/tenant/      — tenant-wide AI context documents
 *   /grounding_documents/competitor/  — competitor-specific documents
 *   /grounding_documents/global/      — global admin documents
 *   /images/logos/                    — tenant logo images
 *   /images/favicons/                 — tenant favicon images
 *
 * Each file has SharePoint column metadata stamped on upload:
 *   DocumentType, Scope, TenantDomain, MarketId, CompetitorId,
 *   CreatedByUserId, FileType, OriginalFileName
 *
 * Adapted from Constellation (synozur-scdp) sharepoint-file-storage.ts.
 */

import { GraphClient, type DriveItemWithMetadata } from "./sharepoint-graph-client.js";
import { db } from "../db.js";
import { tenants } from "@shared/schema";
import { eq } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type OrbitDocumentType =
  | "grounding_document"
  | "logo"
  | "favicon"
  | "report";

export type OrbitDocumentScope =
  | "tenant"
  | "competitor"
  | "global";

export type OrbitReportType =
  | "competitive_analysis"
  | "full_analysis"
  | "project_report"
  | "competitor_intelligence"
  | "battlecard"
  | "product_battlecard"
  | "intelligence_briefing";

export interface OrbitFileMetadata {
  documentType: OrbitDocumentType;
  scope: OrbitDocumentScope;
  tenantDomain?: string;
  marketId?: string;
  competitorId?: string;
  createdByUserId: string;
  fileType: string;              // pdf, docx, txt, png, etc.
  originalFileName: string;
  reportType?: OrbitReportType;  // populated for documentType: "report"
}

export interface StoredOrbitFile {
  /** SharePoint drive-item ID — stored as speFileId in the database. */
  id: string;
  fileName: string;
  originalName: string;
  /** SharePoint web URL for the file. */
  webUrl: string;
  size: number;
  contentType: string;
  metadata: OrbitFileMetadata;
  uploadedAt: Date;
  uploadedBy: string;
}

// ---------------------------------------------------------------------------
// Folder mapping
// ---------------------------------------------------------------------------

const FOLDER_MAP: Record<OrbitDocumentType, Record<OrbitDocumentScope, string>> = {
  grounding_document: {
    tenant:     "/grounding_documents/tenant",
    competitor: "/grounding_documents/competitor",
    global:     "/grounding_documents/global",
  },
  logo:    { tenant: "/images/logos",    competitor: "/images/logos",    global: "/images/logos" },
  favicon: { tenant: "/images/favicons", competitor: "/images/favicons", global: "/images/favicons" },
  report:  { tenant: "/reports",         competitor: "/reports",         global: "/reports" },
};

// ---------------------------------------------------------------------------
// SharePointFileStorage
// ---------------------------------------------------------------------------

export class SharePointFileStorage {
  private graphClient: GraphClient;
  private containerId: string;
  private isProduction: boolean;

  // Per-tenant Graph clients keyed by Azure tenant ID
  private tenantClients = new Map<string, GraphClient>();

  constructor() {
    this.graphClient = new GraphClient();
    this.isProduction =
      process.env.REPLIT_DEPLOYMENT === "1" || process.env.NODE_ENV === "production";

    this.containerId = this.isProduction
      ? process.env.ORBIT_SPE_CONTAINER_ID_PROD || ""
      : process.env.ORBIT_SPE_CONTAINER_ID_DEV || "";

    if (!this.containerId) {
      console.warn(
        "[OrbitSPEStorage] Container ID not configured. " +
        "Set ORBIT_SPE_CONTAINER_ID_DEV / ORBIT_SPE_CONTAINER_ID_PROD."
      );
    } else {
      console.log(`[OrbitSPEStorage] Container: ${this.containerId.substring(0, 20)}… (${this.isProduction ? "prod" : "dev"})`);
    }
  }

  // -------------------------------------------------------------------------
  // Tenant container resolution
  // -------------------------------------------------------------------------

  /**
   * Resolve the container ID and optional Azure tenant ID for a given Orbit
   * tenant.  Tenant-specific containers take priority over the global default.
   */
  async getContainerForTenant(
    tenantId?: string
  ): Promise<{ containerId: string; azureTenantId?: string }> {
    const tryTenant = async (id: string) => {
      const [row] = await db
        .select({
          speContainerIdDev: tenants.speContainerIdDev,
          speContainerIdProd: tenants.speContainerIdProd,
          speStorageEnabled: tenants.speStorageEnabled,
          entraTenantId: tenants.entraTenantId,
        })
        .from(tenants)
        .where(eq(tenants.id, id));

      if (row?.speStorageEnabled) {
        const containerId = this.isProduction
          ? row.speContainerIdProd
          : row.speContainerIdDev;
        if (containerId) {
          return { containerId, azureTenantId: row.entraTenantId || undefined };
        }
      }
      return null;
    };

    if (tenantId) {
      try {
        const result = await tryTenant(tenantId);
        if (result) {
          console.log(`[OrbitSPEStorage] Using tenant container for ${tenantId}: ${result.containerId.substring(0, 20)}…`);
          return result;
        }
      } catch (err) {
        console.warn("[OrbitSPEStorage] Tenant container lookup failed, falling back to global:", err instanceof Error ? err.message : err);
      }
      return { containerId: this.containerId };
    }

    // No tenantId — try to find the sole SPE-enabled tenant
    try {
      const speEnabled = await db
        .select({
          id: tenants.id,
          speContainerIdDev: tenants.speContainerIdDev,
          speContainerIdProd: tenants.speContainerIdProd,
          speStorageEnabled: tenants.speStorageEnabled,
          entraTenantId: tenants.entraTenantId,
        })
        .from(tenants)
        .where(eq(tenants.speStorageEnabled, true));

      if (speEnabled.length === 1) {
        const t = speEnabled[0];
        const containerId = this.isProduction ? t.speContainerIdProd : t.speContainerIdDev;
        if (containerId) {
          return { containerId, azureTenantId: t.entraTenantId || undefined };
        }
      }
    } catch (err) {
      console.warn("[OrbitSPEStorage] SPE-enabled tenant lookup failed:", err instanceof Error ? err.message : err);
    }

    return { containerId: this.containerId };
  }

  resolveGraphClient(azureTenantId?: string): GraphClient {
    if (!azureTenantId) return this.graphClient;
    let client = this.tenantClients.get(azureTenantId);
    if (!client) {
      client = new GraphClient(azureTenantId);
      this.tenantClients.set(azureTenantId, client);
    }
    return client;
  }

  // -------------------------------------------------------------------------
  // Core file operations
  // -------------------------------------------------------------------------

  /**
   * Upload a file to the SPE container.
   *
   * @returns StoredOrbitFile with the SharePoint drive-item ID in `.id`
   *          (to be persisted as `speFileId` in the grounding_documents table).
   */
  async storeFile(
    buffer: Buffer,
    originalName: string,
    contentType: string,
    metadata: OrbitFileMetadata,
    uploadedBy: string,
    fileId?: string,
    tenantId?: string
  ): Promise<StoredOrbitFile> {
    const { containerId, azureTenantId } = await this.getContainerForTenant(tenantId);
    if (!containerId) {
      throw new Error("[OrbitSPEStorage] No container configured. Set ORBIT_SPE_CONTAINER_ID_DEV/PROD.");
    }

    const client = this.resolveGraphClient(azureTenantId);
    const folderPath = this.getFolderPath(metadata.documentType, metadata.scope);
    const safeName = client.sanitizeFileName(originalName);
    const MAX_FILE_NAME_LENGTH = 200;

    let fileName = fileId ? `${fileId}_${safeName}` : `${Date.now()}_${safeName}`;
    if (fileName.length > MAX_FILE_NAME_LENGTH) {
      const lastDot = fileName.lastIndexOf(".");
      if (lastDot > -1 && lastDot < fileName.length - 1) {
        const extension = fileName.slice(lastDot);
        const maxBaseLength = Math.max(1, MAX_FILE_NAME_LENGTH - extension.length);
        const base = fileName.slice(0, maxBaseLength);
        fileName = base + extension;
      } else {
        fileName = fileName.slice(0, MAX_FILE_NAME_LENGTH);
      }
    }
    console.log("[OrbitSPEStorage] Uploading:", { fileName, size: buffer.length, folderPath, contentType });

    const columnValues: Record<string, string | null> = {
      OrbitDocumentType: metadata.documentType,
      OrbitScope: metadata.scope,
      OrbitTenantDomain: metadata.tenantDomain || null,
      OrbitMarketId: metadata.marketId || null,
      OrbitCompetitorId: metadata.competitorId || null,
      OrbitCreatedByUserId: metadata.createdByUserId,
      OrbitFileType: metadata.fileType,
      OrbitOriginalFileName: metadata.originalFileName,
      OrbitReportType: metadata.reportType || null,
    };

    try {
      const driveItem = await client.uploadFile(
        containerId,
        folderPath,
        fileName,
        buffer,
        columnValues
      );

      console.log("[OrbitSPEStorage] Upload successful:", driveItem.id, driveItem.webUrl);

      return {
        id: driveItem.id,
        fileName,
        originalName,
        webUrl: driveItem.webUrl || driveItem.id,
        size: buffer.length,
        contentType,
        metadata,
        uploadedAt: new Date(driveItem.createdDateTime || Date.now()),
        uploadedBy,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[OrbitSPEStorage] Upload failed:", msg);

      if (msg.includes("not supported for AAD accounts")) {
        throw new Error(
          `SPE container not properly configured. Verify ORBIT_SPE_CONTAINER_TYPE_ID is registered. Container: ${containerId.substring(0, 20)}…`
        );
      }
      if (msg.includes("401") || msg.includes("Unauthorized")) {
        throw new Error("SharePoint authentication failed. Check ENTRA_CLIENT_ID, ENTRA_CLIENT_SECRET, and ENTRA_TENANT_ID.");
      }
      if (msg.includes("404") || msg.includes("Not Found")) {
        throw new Error(`Container not found: ${containerId.substring(0, 20)}… — verify ORBIT_SPE_CONTAINER_ID_DEV/PROD.`);
      }

      throw new Error(`File upload to SharePoint failed: ${msg}`);
    }
  }

  /** Retrieve file content and metadata by SharePoint drive-item ID. */
  async getFileContent(
    speFileId: string,
    tenantId?: string
  ): Promise<{ buffer: Buffer; metadata: StoredOrbitFile } | null> {
    const { containerId, azureTenantId } = await this.getContainerForTenant(tenantId);
    if (!containerId) throw new Error("[OrbitSPEStorage] No container configured");

    const client = this.resolveGraphClient(azureTenantId);

    try {
      const [fileMetadata, download] = await Promise.all([
        this.getFileMetadata(speFileId, tenantId),
        client.downloadFile(containerId, speFileId),
      ]);

      if (!fileMetadata) return null;

      return { buffer: download.buffer, metadata: fileMetadata };
    } catch (err) {
      console.error("[OrbitSPEStorage] getFileContent failed:", err instanceof Error ? err.message : err);
      return null;
    }
  }

  /** Fetch metadata for a single file by its drive-item ID. */
  async getFileMetadata(speFileId: string, tenantId?: string): Promise<StoredOrbitFile | null> {
    const { containerId, azureTenantId } = await this.getContainerForTenant(tenantId);
    if (!containerId) throw new Error("[OrbitSPEStorage] No container configured");

    const client = this.resolveGraphClient(azureTenantId);

    try {
      const item = await client.getItem(containerId, speFileId);
      return this.driveItemToStoredFile(item);
    } catch (err) {
      console.error("[OrbitSPEStorage] getFileMetadata failed:", err instanceof Error ? err.message : err);
      return null;
    }
  }

  /** Delete a file from the SPE container by its drive-item ID. */
  async deleteFile(speFileId: string, tenantId?: string): Promise<boolean> {
    const { containerId, azureTenantId } = await this.getContainerForTenant(tenantId);
    if (!containerId) throw new Error("[OrbitSPEStorage] No container configured");

    const client = this.resolveGraphClient(azureTenantId);

    try {
      await client.deleteFile(containerId, speFileId);
      return true;
    } catch (err) {
      console.error("[OrbitSPEStorage] deleteFile failed:", err instanceof Error ? err.message : err);
      return false;
    }
  }

  /**
   * List all files in the container, optionally filtered by document type,
   * scope, tenant domain, or competitor ID.
   */
  async listFiles(
    filter?: {
      documentType?: OrbitDocumentType;
      scope?: OrbitDocumentScope;
      tenantDomain?: string;
      competitorId?: string;
    },
    tenantId?: string
  ): Promise<StoredOrbitFile[]> {
    const { containerId, azureTenantId } = await this.getContainerForTenant(tenantId);
    if (!containerId) throw new Error("[OrbitSPEStorage] No container configured");

    const allItems = await this.listAllFiles(containerId, azureTenantId);

    return allItems
      .filter((item) => {
        const fields = (item.listItem?.fields || {}) as Record<string, unknown>;
        if (filter?.documentType && fields.OrbitDocumentType !== filter.documentType) return false;
        if (filter?.scope && fields.OrbitScope !== filter.scope) return false;
        if (filter?.tenantDomain && fields.OrbitTenantDomain !== filter.tenantDomain) return false;
        if (filter?.competitorId && fields.OrbitCompetitorId !== filter.competitorId) return false;
        return true;
      })
      .map((item) => this.driveItemToStoredFile(item))
      .filter((f): f is StoredOrbitFile => f !== null);
  }

  /** Aggregate storage statistics for the container. */
  async getStorageStats(tenantId?: string): Promise<{
    totalFiles: number;
    totalBytes: number;
    containerInfo: { id: string; displayName: string } | null;
    byDocumentType: Record<string, { count: number; bytes: number }>;
  }> {
    const { containerId, azureTenantId } = await this.getContainerForTenant(tenantId);
    if (!containerId) throw new Error("[OrbitSPEStorage] No container configured");

    const client = this.resolveGraphClient(azureTenantId);

    try {
      const [container, allFiles] = await Promise.all([
        client.getFileStorageContainer(containerId),
        this.listFiles(undefined, tenantId),
      ]);

      const byType: Record<string, { count: number; bytes: number }> = {};
      for (const f of allFiles) {
        const t = f.metadata.documentType;
        if (!byType[t]) byType[t] = { count: 0, bytes: 0 };
        byType[t].count++;
        byType[t].bytes += f.size;
      }

      return {
        totalFiles: allFiles.length,
        totalBytes: allFiles.reduce((s, f) => s + f.size, 0),
        containerInfo: { id: container.id, displayName: container.displayName },
        byDocumentType: byType,
      };
    } catch (err) {
      console.error("[OrbitSPEStorage] getStorageStats failed:", err instanceof Error ? err.message : err);
      return { totalFiles: 0, totalBytes: 0, containerInfo: null, byDocumentType: {} };
    }
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private getFolderPath(docType: OrbitDocumentType, scope: OrbitDocumentScope): string {
    return FOLDER_MAP[docType]?.[scope] ?? "/grounding_documents/tenant";
  }

  /** Walk all known folder trees and collect every file item. */
  private async listAllFiles(containerId: string, azureTenantId?: string): Promise<DriveItemWithMetadata[]> {
    const client = this.resolveGraphClient(azureTenantId);
    const roots = [
      "/grounding_documents/tenant",
      "/grounding_documents/competitor",
      "/grounding_documents/global",
      "/images/logos",
      "/images/favicons",
      "/reports",
    ];

    const all: DriveItemWithMetadata[] = [];

    const walk = async (path: string, depth = 0): Promise<void> => {
      if (depth > 4) return;
      try {
        const items = await client.listFiles(containerId, path);
        for (const item of items) {
          if (item.folder) {
            await walk(`${path}/${item.name}`, depth + 1);
          } else {
            all.push(item);
          }
        }
      } catch (err) {
        // Folder may not exist yet — ignore silently at root depth
        if (depth > 0) throw err;
      }
    };

    for (const root of roots) {
      await walk(root, 0).catch(() => {/* root folder does not exist yet */});
    }

    console.log(`[OrbitSPEStorage] listAllFiles: found ${all.length} files`);
    return all;
  }

  private driveItemToStoredFile(item: DriveItemWithMetadata): StoredOrbitFile | null {
    if (!item?.id) return null;

    const fields = (item.listItem?.fields || {}) as Record<string, unknown>;

    const metadata: OrbitFileMetadata = {
      documentType: (fields.OrbitDocumentType as OrbitDocumentType) || "grounding_document",
      scope: (fields.OrbitScope as OrbitDocumentScope) || "tenant",
      tenantDomain: fields.OrbitTenantDomain as string | undefined,
      marketId: fields.OrbitMarketId as string | undefined,
      competitorId: fields.OrbitCompetitorId as string | undefined,
      createdByUserId: (fields.OrbitCreatedByUserId as string) || "unknown",
      fileType: (fields.OrbitFileType as string) || "unknown",
      originalFileName: (fields.OrbitOriginalFileName as string) || item.name,
      reportType: (fields.OrbitReportType as OrbitReportType) || undefined,
    };

    return {
      id: item.id,
      fileName: item.name,
      originalName: metadata.originalFileName,
      webUrl: item.webUrl || item.id,
      size: item.size || 0,
      contentType: item.file?.mimeType || "application/octet-stream",
      metadata,
      uploadedAt: new Date(item.createdDateTime || Date.now()),
      uploadedBy: metadata.createdByUserId,
    };
  }
}

// Singleton for use across the server
export const sharepointFileStorage = new SharePointFileStorage();
