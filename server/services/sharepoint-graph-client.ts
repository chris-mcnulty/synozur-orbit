/**
 * SharePoint Embedded Graph API Client for Synozur Orbit
 *
 * Handles authentication (MSAL client credentials) and all Microsoft Graph API
 * calls needed for SharePoint Embedded (SPE) container operations:
 * file upload, download, delete, list, and container metadata.
 *
 * Adapted from Constellation (synozur-scdp) graph-client.ts.
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

const GRAPH_BETA_URL = "https://graph.microsoft.com/beta";
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

  // Token cache
  private cachedToken: string | null = null;
  private tokenExpiresAt = 0;

  // Container/drive ID cache
  private containerCache = new Map<string, { data: FileStorageContainer; expiresAt: number }>();

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

        // Extract status code from error message if present
        const statusMatch = msg.match(/→ (\d{3})/);
        const status = statusMatch ? parseInt(statusMatch[1]) : 0;

        if (status === 429) {
          // Rate limited — honour Retry-After if we can parse it from the message
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

        // 4xx (except 429) — no retry
        throw lastError;
      }
    }

    throw lastError!;
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
        `${GRAPH_BETA_URL}/storage/fileStorage/containers/${containerId}`
      )
    );

    this.containerCache.set(containerId, { data, expiresAt: Date.now() + CACHE_TTL_MS });
    return data;
  }

  // -------------------------------------------------------------------------
  // File operations
  // -------------------------------------------------------------------------

  /** Sanitise a filename for SharePoint. */
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

  /** Validate path segments to prevent traversal attacks. */
  private validatePath(folderPath: string): void {
    if (folderPath.includes("..")) {
      throw new Error(`[SPE GraphClient] Path traversal detected in: ${folderPath}`);
    }
  }

  /**
   * Upload a file to a SharePoint Embedded container.
   *
   * Uses simple PUT for files ≤ 4 MB and the resumable upload session for larger files.
   * Optionally updates SharePoint list-item column values after upload.
   */
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

    // Ensure the target folder exists before uploading
    await this.ensureFolder(containerId, cleanFolder);

    const encodedFolder = cleanFolder
      .split("/")
      .map((s) => encodeURIComponent(s))
      .join("/");
    const encodedName = encodeURIComponent(safeName);

    let driveItem: DriveItemWithMetadata;

    if (buffer.length <= MAX_SIMPLE_UPLOAD_BYTES) {
      driveItem = await this.withRetry(() =>
        this.request<DriveItemWithMetadata>(
          `${GRAPH_BETA_URL}/storage/fileStorage/containers/${containerId}/drive/root:${encodedFolder}/${encodedName}:/content`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/octet-stream" },
            body: buffer,
          }
        )
      );
    } else {
      driveItem = await this.resumableUpload(containerId, cleanFolder, safeName, buffer);
    }

    // Optionally stamp column metadata on the list item
    if (columnValues && driveItem.id) {
      try {
        await this.updateListItemFields(containerId, driveItem.id, columnValues);
      } catch (err) {
        console.warn("[SPE GraphClient] Column metadata update failed (non-fatal):", err instanceof Error ? err.message : err);
      }
    }

    return driveItem;
  }

  /** Create a resumable upload session and stream the buffer in chunks. */
  private async resumableUpload(
    containerId: string,
    folderPath: string,
    fileName: string,
    buffer: Buffer
  ): Promise<DriveItemWithMetadata> {
    const encodedFolder = folderPath
      .split("/")
      .map((s) => encodeURIComponent(s))
      .join("/");
    const encodedName = encodeURIComponent(fileName);

    const sessionData = await this.withRetry(() =>
      this.request<{ uploadUrl: string }>(
        `${GRAPH_BETA_URL}/storage/fileStorage/containers/${containerId}/drive/root:${encodedFolder}/${encodedName}:/createUploadSession`,
        {
          method: "POST",
          body: JSON.stringify({ item: { "@microsoft.graph.conflictBehavior": "rename" } }),
        }
      )
    );

    const uploadUrl = sessionData.uploadUrl;
    const chunkSize = 5 * 1024 * 1024; // 5 MB chunks
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

      if (!response.ok && response.status !== 202) {
        const detail = await response.text().catch(() => "");
        throw new Error(`[SPE GraphClient] Resumable upload chunk failed at ${offset}: ${response.status} ${detail}`);
      }

      if (response.status !== 202) {
        lastResponse = await response.json() as DriveItemWithMetadata;
      }

      offset = end;
    }

    if (!lastResponse) {
      throw new Error("[SPE GraphClient] Resumable upload completed but no drive item returned");
    }

    return lastResponse;
  }

  /** Download a file by its drive item ID. */
  async downloadFile(containerId: string, itemId: string): Promise<DownloadResult> {
    const item = await this.withRetry(() =>
      this.request<DriveItemWithMetadata>(
        `${GRAPH_BETA_URL}/storage/fileStorage/containers/${containerId}/drive/items/${itemId}`
      )
    );

    if (item.folder) {
      throw new Error(`[SPE GraphClient] Item ${itemId} is a folder, not a file`);
    }

    // Prefer the pre-auth download URL when available to avoid a second token round-trip
    const downloadUrl =
      item["@microsoft.graph.downloadUrl"] ||
      `${GRAPH_BETA_URL}/storage/fileStorage/containers/${containerId}/drive/items/${itemId}/content`;

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

  /** Delete a drive item (file or folder) by ID. */
  async deleteFile(containerId: string, itemId: string): Promise<void> {
    await this.withRetry(() =>
      this.request<void>(
        `${GRAPH_BETA_URL}/storage/fileStorage/containers/${containerId}/drive/items/${itemId}`,
        { method: "DELETE" }
      )
    );
  }

  /**
   * List the direct children (files + subfolders) of a folder path.
   * Returns all pages via automatic pagination.
   */
  async listFiles(containerId: string, folderPath: string): Promise<DriveItemWithMetadata[]> {
    this.validatePath(folderPath);

    const clean = folderPath.startsWith("/") ? folderPath : `/${folderPath}`;
    const encoded = clean
      .split("/")
      .map((s) => encodeURIComponent(s))
      .join("/");

    const baseUrl =
      clean === "/"
        ? `${GRAPH_BETA_URL}/storage/fileStorage/containers/${containerId}/drive/root/children?$expand=listItem($expand=fields)&$top=200`
        : `${GRAPH_BETA_URL}/storage/fileStorage/containers/${containerId}/drive/root:${encoded}:/children?$expand=listItem($expand=fields)&$top=200`;

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
      // We hit the pagination cap (50 pages) but the API still returned a nextLink,
      // which means the result set is incomplete.
      // Log a warning so operators can detect that the listing was truncated.
      console.warn(
        `SharePointGraphClient.listFiles: pagination cap (50 pages) reached for container '${containerId}' and path '${folderPath}'. Results may be incomplete.`
      );
    }
    return items;
  }

  /** Fetch a single drive item with its list-item fields. */
  async getItem(containerId: string, itemId: string): Promise<DriveItemWithMetadata> {
    return this.withRetry(() =>
      this.request<DriveItemWithMetadata>(
        `${GRAPH_BETA_URL}/storage/fileStorage/containers/${containerId}/drive/items/${itemId}?$expand=listItem($expand=fields)`
      )
    );
  }

  // -------------------------------------------------------------------------
  // Folder helpers
  // -------------------------------------------------------------------------

  /**
   * Ensure that every segment of `folderPath` exists inside the container,
   * creating any missing folders idempotently.
   */
  async ensureFolder(containerId: string, folderPath: string): Promise<void> {
    this.validatePath(folderPath);

    const segments = folderPath.split("/").filter(Boolean);
    let currentPath = "";

    for (const segment of segments) {
      const parentPath = currentPath || "/";
      currentPath = `${currentPath}/${segment}`;

      try {
        const encodedCurrent = currentPath
          .split("/")
          .map((s) => encodeURIComponent(s))
          .join("/");
        await this.request(
          `${GRAPH_BETA_URL}/storage/fileStorage/containers/${containerId}/drive/root:${encodedCurrent}`
        );
        // Folder already exists — continue
      } catch (err) {
        const msg = err instanceof Error ? err.message : "";
        if (!msg.includes("404")) {
          throw err;
        }

        // Create the folder
        const encodedParent =
          parentPath === "/"
            ? ""
            : parentPath.split("/").map((s) => encodeURIComponent(s)).join("/");

        const createUrl =
          parentPath === "/"
            ? `${GRAPH_BETA_URL}/storage/fileStorage/containers/${containerId}/drive/root/children`
            : `${GRAPH_BETA_URL}/storage/fileStorage/containers/${containerId}/drive/root:${encodedParent}:/children`;

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
          // 409 Conflict = already exists (race condition) — safe to ignore
          const createMsg = createErr instanceof Error ? createErr.message : "";
          if (!createMsg.includes("409")) throw createErr;
        });
      }
    }
  }

  // -------------------------------------------------------------------------
  // Column / metadata helpers
  // -------------------------------------------------------------------------

  /** Update SharePoint list-item columns for a drive item. */
  async updateListItemFields(
    containerId: string,
    itemId: string,
    fields: Record<string, string | number | boolean | null>
  ): Promise<void> {
    await this.withRetry(() =>
      this.request(
        `${GRAPH_BETA_URL}/storage/fileStorage/containers/${containerId}/drive/items/${itemId}/listItem/fields`,
        {
          method: "PATCH",
          body: JSON.stringify(fields),
        }
      )
    );
  }

  /**
   * Initialise metadata columns on a container.
   * Columns that already exist are skipped gracefully.
   */
  async initializeContainerColumns(containerId: string, columns: ColumnDefinition[]): Promise<void> {
    const siteId = await this.getSiteIdForContainer(containerId);

    for (const col of columns) {
      try {
        await this.withRetry(() =>
          this.request(
            `${GRAPH_BETA_URL}/sites/${siteId}/lists/${containerId}/columns`,
            {
              method: "POST",
              body: JSON.stringify(col),
            }
          )
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : "";
        // 422 / "already exists" — safe to skip
        if (!msg.includes("422") && !msg.includes("already") && !msg.includes("duplicate")) {
          console.warn(`[SPE GraphClient] Column ${col.name} init warning:`, msg);
        }
      }
    }
  }

  private async getSiteIdForContainer(containerId: string): Promise<string> {
    const container = await this.getFileStorageContainer(containerId);
    // Container ID and site ID are the same for SPE containers accessed via Graph
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
