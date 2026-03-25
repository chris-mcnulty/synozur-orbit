/**
 * SharePoint Embedded Graph API Client for Synozur Orbit
 *
 * Handles authentication (MSAL client credentials) and all Microsoft Graph API
 * calls needed for SharePoint Embedded (SPE) container operations:
 * file upload, download, delete, list, and container metadata.
 *
 * Adapted from Constellation (synozur-scdp) graph-client.ts.
 *
 * KEY ARCHITECTURE NOTE:
 * SPE containers do NOT support chaining drive operations off the container path
 * (e.g. /storage/fileStorage/containers/{id}/drive/root:...). Instead, we must:
 *   1. Resolve the container's drive ID via GET /storage/fileStorage/containers/{id}/drive
 *   2. Use standard /drives/{driveId}/... endpoints for ALL file operations
 * This matches Constellation's working implementation exactly.
 */

import * as msal from "@azure/msal-node";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DriveItemWithMetadata {
  id: string;
  name: string;
  size?: number;
  webUrl?: string;
  createdDateTime?: string;
  lastModifiedDateTime?: string;
  folder?: { childCount: number };
  file?: { mimeType: string };
  "@microsoft.graph.downloadUrl"?: string;
  listItem?: {
    fields?: Record<string, unknown>;
  };
}

interface FileStorageContainer {
  id: string;
  displayName: string;
  status?: string;
  storageUsedInBytes?: number;
}

interface DownloadResult {
  buffer: Buffer;
  mimeType: string;
  fileName: string;
  size: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GRAPH_V1_URL = "https://graph.microsoft.com/v1.0";
const MAX_SIMPLE_UPLOAD_BYTES = 4 * 1024 * 1024; // 4 MB — use resumable above this
const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024; // 100 MB hard limit
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_RETRIES = 3;

// Characters forbidden in SharePoint file names
const FORBIDDEN_CHARS_RE = /[<>:"/\\|?*\x00-\x1f~#%&{}]/g;

// Windows reserved names (case-insensitive)
const WINDOWS_RESERVED = new Set([
  "CON", "PRN", "AUX", "NUL",
  "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
  "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
]);

// ---------------------------------------------------------------------------
// GraphClient
// ---------------------------------------------------------------------------

export class GraphClient {
  private azureTenantId?: string;

  private cachedToken: string | null = null;
  private tokenExpiresAt = 0;

  private containerCache = new Map<string, { data: FileStorageContainer; expiresAt: number }>();
  private driveIdCache = new Map<string, { driveId: string; expiresAt: number }>();

  constructor(azureTenantId?: string) {
    this.azureTenantId = azureTenantId;
  }

  // -------------------------------------------------------------------------
  // Authentication
  // -------------------------------------------------------------------------

  private async authenticate(): Promise<string> {
    const now = Date.now();
    if (this.cachedToken && now < this.tokenExpiresAt - 5 * 60 * 1000) {
      return this.cachedToken;
    }

    const msalInstance = this.getMsalInstance();
    const result = await msalInstance.acquireTokenByClientCredential({
      scopes: ["https://graph.microsoft.com/.default"],
    });

    if (!result?.accessToken) {
      throw new Error("[SPE GraphClient] Failed to acquire access token from MSAL");
    }

    this.cachedToken = result.accessToken;
    this.tokenExpiresAt = result.expiresOn ? result.expiresOn.getTime() : now + 60 * 60 * 1000;
    return this.cachedToken;
  }

  private getMsalInstance(): msal.ConfidentialClientApplication {
    const clientId = process.env.ENTRA_CLIENT_ID;
    const clientSecret = process.env.ENTRA_CLIENT_SECRET;
    const tenantId = this.azureTenantId || process.env.ENTRA_TENANT_ID;

    if (!clientId || !clientSecret || !tenantId) {
      throw new Error(
        "[SPE GraphClient] Missing Azure AD credentials. " +
        "Set ENTRA_CLIENT_ID, ENTRA_CLIENT_SECRET, and ENTRA_TENANT_ID."
      );
    }

    return new msal.ConfidentialClientApplication({
      auth: {
        clientId,
        authority: `https://login.microsoftonline.com/${tenantId}`,
        clientSecret,
      },
      system: {
        loggerOptions: {
          loggerCallback(_, message) {
            if (process.env.NODE_ENV === "development") {
              console.log("[MSAL-SPE]", message);
            }
          },
          piiLoggingEnabled: false,
          logLevel: msal.LogLevel.Warning,
        },
      },
    });
  }

  // -------------------------------------------------------------------------
  // HTTP helpers
  // -------------------------------------------------------------------------

  private async request<T = unknown>(
    url: string,
    options: RequestInit = {},
    expectBinary = false
  ): Promise<T> {
    const token = await this.authenticate();

    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      ...(options.headers as Record<string, string> | undefined),
    };

    if (!expectBinary && options.body && typeof options.body === "string") {
      headers["Content-Type"] = "application/json";
    }

    const response = await fetch(url, { ...options, headers });

    if (!response.ok) {
      let detail = "";
      try {
        const errBody = await response.json() as { error?: { message?: string; code?: string } };
        detail = errBody.error?.message || errBody.error?.code || "";
      } catch {
        detail = await response.text().catch(() => "");
      }
      throw new Error(
        `[SPE GraphClient] ${options.method || "GET"} ${url} → ${response.status} ${response.statusText}` +
        (detail ? `: ${detail}` : "")
      );
    }

    if (response.status === 204) {
      return undefined as unknown as T;
    }

    if (expectBinary) {
      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer) as unknown as T;
    }

    return response.json() as Promise<T>;
  }

  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        const msg = lastError.message;

        const statusMatch = msg.match(/→ (\d{3})/);
        const status = statusMatch ? parseInt(statusMatch[1]) : 0;

        if (status === 429) {
          const retryAfterMatch = msg.match(/retry.after[:\s]+(\d+)/i);
          const waitSec = retryAfterMatch ? parseInt(retryAfterMatch[1]) : Math.pow(2, attempt) * 2;
          const jitter = waitSec * 0.3 * Math.random();
          const delay = Math.min((waitSec + jitter) * 1000, 30_000);
          await sleep(delay);
          continue;
        }

        if (status >= 500 || status === 0) {
          if (attempt < MAX_RETRIES) {
            const delay = Math.min(Math.pow(2, attempt) * 1000 * (1 + 0.3 * Math.random()), 30_000);
            await sleep(delay);
            continue;
          }
        }

        throw lastError;
      }
    }

    throw lastError!;
  }

  // -------------------------------------------------------------------------
  // Drive ID resolution (matches Constellation pattern)
  // -------------------------------------------------------------------------

  async getContainerDriveId(containerId: string): Promise<string> {
    const now = Date.now();
    const cached = this.driveIdCache.get(containerId);
    if (cached && now < cached.expiresAt) {
      return cached.driveId;
    }

    try {
      const driveData = await this.withRetry(() =>
        this.request<{ id: string; driveType: string }>(
          `${GRAPH_V1_URL}/storage/fileStorage/containers/${containerId}/drive`
        )
      );

      if (driveData?.id) {
        console.log(`[SPE GraphClient] Resolved container ${containerId.substring(0, 15)}... to drive ${driveData.id.substring(0, 15)}... (type: ${driveData.driveType})`);
        this.driveIdCache.set(containerId, { driveId: driveData.id, expiresAt: now + CACHE_TTL_MS });
        return driveData.id;
      }
    } catch (error) {
      console.warn(`[SPE GraphClient] Drive resolution failed, using container ID directly:`, error instanceof Error ? error.message : error);
    }

    this.driveIdCache.set(containerId, { driveId: containerId, expiresAt: now + CACHE_TTL_MS });
    return containerId;
  }

  private driveEndpoint(driveId: string): string {
    return `${GRAPH_V1_URL}/drives/${driveId}`;
  }

  // -------------------------------------------------------------------------
  // Container operations
  // -------------------------------------------------------------------------

  async getFileStorageContainer(containerId: string): Promise<FileStorageContainer> {
    const cached = this.containerCache.get(containerId);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.data;
    }

    const data = await this.withRetry(() =>
      this.request<FileStorageContainer>(
        `${GRAPH_V1_URL}/storage/fileStorage/containers/${containerId}`
      )
    );

    this.containerCache.set(containerId, { data, expiresAt: Date.now() + CACHE_TTL_MS });
    return data;
  }

  // -------------------------------------------------------------------------
  // File operations (all use /drives/{driveId}/... pattern)
  // -------------------------------------------------------------------------

  sanitizeFileName(name: string): string {
    const ext = name.includes(".")
      ? "." + name.split(".").pop()!.replace(FORBIDDEN_CHARS_RE, "_")
      : "";
    const base = name
      .slice(0, name.length - ext.length)
      .replace(FORBIDDEN_CHARS_RE, "_")
      .replace(/^[\s.]+|[\s.]+$/g, "_")
      .slice(0, 255 - ext.length) || "file";

    if (WINDOWS_RESERVED.has(base.toUpperCase())) {
      return `_${base}${ext}`;
    }
    return `${base}${ext}`;
  }

  private validatePath(folderPath: string): void {
    if (folderPath.includes("..")) {
      throw new Error(`[SPE GraphClient] Path traversal detected in: ${folderPath}`);
    }
  }

  async uploadFile(
    containerId: string,
    folderPath: string,
    fileName: string,
    buffer: Buffer,
    columnValues?: Record<string, string | number | boolean | null>
  ): Promise<DriveItemWithMetadata> {
    this.validatePath(folderPath);

    if (buffer.length > MAX_FILE_SIZE_BYTES) {
      throw new Error(
        `[SPE GraphClient] File too large: ${buffer.length} bytes (max ${MAX_FILE_SIZE_BYTES})`
      );
    }

    const safeName = this.sanitizeFileName(fileName);
    const cleanFolder = folderPath.startsWith("/") ? folderPath : `/${folderPath}`;
    const driveId = await this.getContainerDriveId(containerId);
    const drivePath = this.driveEndpoint(driveId);

    await this.ensureFolder(containerId, cleanFolder, driveId);

    const uploadPath = `${cleanFolder}/${safeName}`.replace(/\/+/g, "/");

    let driveItem: DriveItemWithMetadata;

    if (buffer.length <= MAX_SIMPLE_UPLOAD_BYTES) {
      console.log(`[SPE GraphClient] Uploading file:`, {
        containerId: containerId.substring(0, 15) + "...",
        driveId: driveId.substring(0, 15) + "...",
        uploadPath,
        fileName: safeName,
        fileSize: buffer.length,
      });

      driveItem = await this.withRetry(() =>
        this.request<DriveItemWithMetadata>(
          `${drivePath}/root:${uploadPath}:/content`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/octet-stream" },
            body: buffer,
          }
        )
      );
    } else {
      driveItem = await this.resumableUpload(driveId, uploadPath, buffer);
    }

    if (columnValues && driveItem.id) {
      try {
        await this.updateListItemFields(containerId, driveItem.id, columnValues);
      } catch (err) {
        console.warn("[SPE GraphClient] Column metadata update failed (non-fatal):", err instanceof Error ? err.message : err);
      }
    }

    return driveItem;
  }

  private async resumableUpload(
    driveId: string,
    uploadPath: string,
    buffer: Buffer
  ): Promise<DriveItemWithMetadata> {
    const drivePath = this.driveEndpoint(driveId);

    const sessionData = await this.withRetry(() =>
      this.request<{ uploadUrl: string }>(
        `${drivePath}/root:${uploadPath}:/createUploadSession`,
        {
          method: "POST",
          body: JSON.stringify({ item: { "@microsoft.graph.conflictBehavior": "replace" } }),
        }
      )
    );

    const uploadUrl = sessionData.uploadUrl;
    const chunkSize = 5 * 1024 * 1024;
    let offset = 0;
    let lastResponse: DriveItemWithMetadata | undefined;

    while (offset < buffer.length) {
      const end = Math.min(offset + chunkSize, buffer.length);
      const chunk = buffer.slice(offset, end);

      const response = await fetch(uploadUrl, {
        method: "PUT",
        headers: {
          "Content-Length": String(chunk.length),
          "Content-Range": `bytes ${offset}-${end - 1}/${buffer.length}`,
          "Content-Type": "application/octet-stream",
        },
        body: chunk,
      });

      if (response.status === 200 || response.status === 201) {
        lastResponse = await response.json() as DriveItemWithMetadata;
      } else if (response.status === 202) {
        // chunk accepted, continue
      } else {
        const detail = await response.text().catch(() => "");
        throw new Error(`[SPE GraphClient] Resumable upload chunk failed at ${offset}: ${response.status} ${detail}`);
      }

      offset = end;
    }

    if (!lastResponse) {
      throw new Error("[SPE GraphClient] Resumable upload completed but no drive item returned");
    }

    return lastResponse;
  }

  async downloadFile(containerId: string, itemId: string): Promise<DownloadResult> {
    const driveId = await this.getContainerDriveId(containerId);
    const drivePath = this.driveEndpoint(driveId);

    const item = await this.withRetry(() =>
      this.request<DriveItemWithMetadata>(
        `${drivePath}/items/${itemId}`
      )
    );

    if (item.folder) {
      throw new Error(`[SPE GraphClient] Item ${itemId} is a folder, not a file`);
    }

    const downloadUrl = item["@microsoft.graph.downloadUrl"];
    if (!downloadUrl) {
      throw new Error(`[SPE GraphClient] No download URL available for item ${itemId}`);
    }

    const buffer = await this.withRetry(async () => {
      const r = await fetch(downloadUrl);
      if (!r.ok) {
        throw new Error(`[SPE GraphClient] Download failed: ${r.status} ${r.statusText}`);
      }
      return Buffer.from(await r.arrayBuffer());
    });

    return {
      buffer,
      mimeType: item.file?.mimeType || "application/octet-stream",
      fileName: item.name,
      size: item.size || buffer.length,
    };
  }

  async deleteFile(containerId: string, itemId: string): Promise<void> {
    const driveId = await this.getContainerDriveId(containerId);
    await this.withRetry(() =>
      this.request<void>(
        `${this.driveEndpoint(driveId)}/items/${itemId}`,
        { method: "DELETE" }
      )
    );
  }

  async listFiles(containerId: string, folderPath: string): Promise<DriveItemWithMetadata[]> {
    this.validatePath(folderPath);

    const clean = folderPath.startsWith("/") ? folderPath : `/${folderPath}`;
    const driveId = await this.getContainerDriveId(containerId);
    const drivePath = this.driveEndpoint(driveId);

    const pathForApi = clean === "/" ? "" : `:${clean}:`;
    const baseUrl = `${drivePath}/root${pathForApi}/children?$expand=listItem($expand=fields)&$top=200`;

    const items: DriveItemWithMetadata[] = [];
    let nextUrl: string | undefined = baseUrl;
    let pages = 0;

    while (nextUrl && pages < 50) {
      const page = await this.withRetry(() =>
        this.request<{ value: DriveItemWithMetadata[]; "@odata.nextLink"?: string }>(nextUrl!)
      );
      items.push(...page.value);
      nextUrl = page["@odata.nextLink"];
      pages++;
    }

    if (nextUrl) {
      console.warn(
        `[SPE GraphClient] listFiles pagination cap (50 pages) reached for container '${containerId}' path '${folderPath}'. Results may be incomplete.`
      );
    }
    return items;
  }

  async getItem(containerId: string, itemId: string): Promise<DriveItemWithMetadata> {
    const driveId = await this.getContainerDriveId(containerId);
    return this.withRetry(() =>
      this.request<DriveItemWithMetadata>(
        `${this.driveEndpoint(driveId)}/items/${itemId}?$expand=listItem($expand=fields)`
      )
    );
  }

  // -------------------------------------------------------------------------
  // Folder helpers
  // -------------------------------------------------------------------------

  async ensureFolder(containerId: string, folderPath: string, driveId?: string): Promise<void> {
    this.validatePath(folderPath);

    const resolvedDriveId = driveId || await this.getContainerDriveId(containerId);
    const drivePath = this.driveEndpoint(resolvedDriveId);
    const segments = folderPath.split("/").filter(Boolean);
    let currentPath = "";

    for (const segment of segments) {
      const parentPath = currentPath || "/";
      currentPath = `${currentPath}/${segment}`;

      try {
        await this.request(
          `${drivePath}/root:${currentPath}`
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : "";
        if (!msg.includes("404")) {
          throw err;
        }

        const parentPathForApi = parentPath === "/" ? "" : `:${parentPath}:`;
        const createUrl = `${drivePath}/root${parentPathForApi}/children`;

        await this.withRetry(() =>
          this.request(createUrl, {
            method: "POST",
            body: JSON.stringify({
              name: segment,
              folder: {},
              "@microsoft.graph.conflictBehavior": "fail",
            }),
          })
        ).catch((createErr) => {
          const createMsg = createErr instanceof Error ? createErr.message : "";
          if (!createMsg.includes("409") && !createMsg.includes("nameAlreadyExists")) throw createErr;
        });
      }
    }
  }

  // -------------------------------------------------------------------------
  // Column / metadata helpers
  // -------------------------------------------------------------------------

  async updateListItemFields(
    containerId: string,
    itemId: string,
    fields: Record<string, string | number | boolean | null>
  ): Promise<void> {
    const driveId = await this.getContainerDriveId(containerId);
    await this.withRetry(() =>
      this.request(
        `${this.driveEndpoint(driveId)}/items/${itemId}/listItem/fields`,
        {
          method: "PATCH",
          body: JSON.stringify(fields),
        }
      )
    );
  }

  async initializeContainerColumns(containerId: string, columns: ColumnDefinition[]): Promise<void> {
    const siteId = await this.getSiteIdForContainer(containerId);

    for (const col of columns) {
      try {
        await this.withRetry(() =>
          this.request(
            `${GRAPH_V1_URL}/sites/${siteId}/lists/${containerId}/columns`,
            {
              method: "POST",
              body: JSON.stringify(col),
            }
          )
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : "";
        if (!msg.includes("422") && !msg.includes("already") && !msg.includes("duplicate") && !msg.includes("is not recognized")) {
          console.warn(`[SPE GraphClient] Column ${col.name} init warning:`, msg);
        }
      }
    }
  }

  private async getSiteIdForContainer(containerId: string): Promise<string> {
    const container = await this.getFileStorageContainer(containerId);
    return container.id;
  }
}

// ---------------------------------------------------------------------------
// Column definition type (subset of Graph API column schema)
// ---------------------------------------------------------------------------

export interface ColumnDefinition {
  name: string;
  displayName?: string;
  description?: string;
  text?: Record<string, unknown>;
  choice?: { allowTextEntry?: boolean; choices: string[] };
  dateTime?: { displayAs?: string; format?: string };
  number?: { decimalPlaces?: string; displayAs?: string };
  currency?: { locale?: string };
  boolean?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
