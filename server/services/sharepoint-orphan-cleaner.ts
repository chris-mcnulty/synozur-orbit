/**
 * SharePoint Embedded Orphaned File Manager for Synozur Orbit
 *
 * An "orphaned file" is a file that exists in the SPE container but has no
 * corresponding database record referencing it (i.e. no grounding_document
 * row with a matching speFileId).
 *
 * This service provides:
 *   - scanForOrphans()       — compare SPE files against the DB, return orphan list
 *   - deleteOrphans()        — delete a specific list of confirmed orphans
 *   - runOrphanCleanup()     — full scan → report → optional auto-delete
 *   - getOrphanReport()      — lightweight report for admin dashboard
 *
 * Design principles
 *   - NEVER silently delete files.  All deletions are logged and confirmed.
 *   - Auto-delete is OFF by default (dryRun: true).
 *   - Files younger than SAFE_AGE_HOURS are exempt from deletion even if
 *     they appear orphaned, to handle the race between upload and DB insert.
 */

import { db } from "../db.js";
import { groundingDocuments, globalGroundingDocuments, tenants } from "@shared/schema";
import { eq, isNotNull } from "drizzle-orm";
import { sharepointFileStorage } from "./sharepoint-file-storage.js";
import type { StoredOrbitFile } from "./sharepoint-file-storage.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OrphanedFile {
  /** SharePoint drive-item ID */
  speFileId: string;
  fileName: string;
  webUrl: string;
  size: number;
  uploadedAt: Date;
  /** Inferred document type from SPE column metadata */
  documentType: string;
  tenantDomain?: string;
  /** Orbit tenant UUID the file belongs to; populated during multi-tenant scans */
  orbitTenantId?: string;
}

export interface OrphanScanResult {
  scannedAt: Date;
  totalFilesInSpe: number;
  totalFilesInDb: number;
  orphanCount: number;
  orphans: OrphanedFile[];
  /** Files exempt from deletion because they are too new */
  exemptCount: number;
  /** Duration of the scan in milliseconds */
  durationMs: number;
}

export interface OrphanCleanupResult extends OrphanScanResult {
  dryRun: boolean;
  deletedCount: number;
  failedCount: number;
  deletedFileIds: string[];
  failedFileIds: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Files younger than this many hours are treated as safe (not yet orphaned) */
const SAFE_AGE_HOURS = 2;

// ---------------------------------------------------------------------------
// OrphanedFileManager
// ---------------------------------------------------------------------------

export class OrphanedFileManager {

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Scan the SPE container(s) and return a list of files that have no matching
   * database record.
   *
   * When `tenantId` is supplied the scan is scoped to that tenant's container.
   * When omitted the scan iterates every SPE-enabled tenant's container so
   * that no tenant is missed in a multi-tenant deployment.
   *
   * @param tenantId  Optional Orbit tenant UUID to scope the scan
   */
  async scanForOrphans(tenantId?: string): Promise<OrphanScanResult> {
    const startedAt = Date.now();

    // 1. Collect all known speFileIds from the database (once, upfront)
    const knownIds = await this.loadKnownSpeFileIds();
    const now = new Date();
    const safeAgeMs = SAFE_AGE_HOURS * 60 * 60 * 1000;

    // 2. Gather SPE files — either from a single tenant or all SPE-enabled tenants
    let taggedFiles: Array<{ file: StoredOrbitFile; orbitTenantId?: string }>;

    if (tenantId) {
      console.log(`[OrphanManager] Starting orphan scan (tenant: ${tenantId})`);
      const files = await sharepointFileStorage.listFiles(undefined, tenantId);
      taggedFiles = files.map((f) => ({ file: f, orbitTenantId: tenantId }));
    } else {
      const tenantIds = await this.getSpeEnabledTenantIds();
      if (tenantIds.length === 0) {
        // No per-tenant containers — fall back to the global default container
        console.log("[OrphanManager] No SPE-enabled tenants found; scanning global container");
        const files = await sharepointFileStorage.listFiles(undefined, undefined);
        taggedFiles = files.map((f) => ({ file: f }));
      } else {
        console.log(`[OrphanManager] Starting orphan scan across ${tenantIds.length} SPE-enabled tenant(s)`);
        const perTenant = await Promise.all(
          tenantIds.map(async (tid) => {
            const files = await sharepointFileStorage.listFiles(undefined, tid);
            return files.map((f) => ({ file: f, orbitTenantId: tid }));
          })
        );
        taggedFiles = perTenant.flat();
      }
    }

    const orphans: OrphanedFile[] = [];
    let exemptCount = 0;

    for (const { file, orbitTenantId } of taggedFiles) {
      if (knownIds.has(file.id)) continue;

      // Exempt recently uploaded files (race condition buffer)
      const ageMs = now.getTime() - file.uploadedAt.getTime();
      if (ageMs < safeAgeMs) {
        exemptCount++;
        continue;
      }

      orphans.push({
        speFileId: file.id,
        fileName: file.fileName,
        webUrl: file.webUrl,
        size: file.size,
        uploadedAt: file.uploadedAt,
        documentType: file.metadata.documentType,
        tenantDomain: file.metadata.tenantDomain,
        orbitTenantId,
      });
    }

    const result: OrphanScanResult = {
      scannedAt: now,
      totalFilesInSpe: taggedFiles.length,
      totalFilesInDb: knownIds.size,
      orphanCount: orphans.length,
      orphans,
      exemptCount,
      durationMs: Date.now() - startedAt,
    };

    console.log(
      `[OrphanManager] Scan complete: ${taggedFiles.length} SPE files, ` +
      `${knownIds.size} DB records, ${orphans.length} orphans found ` +
      `(${exemptCount} exempt), took ${result.durationMs}ms`
    );

    return result;
  }

  /**
   * Delete specific orphaned files from the SPE container.
   *
   * Only call this with IDs that have been confirmed as orphans by scanForOrphans().
   *
   * @param speFileIds  Array of drive-item IDs to delete
   * @param tenantId    Optional tenant context for container resolution
   */
  async deleteOrphans(
    speFileIds: string[],
    tenantId?: string
  ): Promise<{ deletedCount: number; failedCount: number; deletedFileIds: string[]; failedFileIds: string[] }> {
    const deleted: string[] = [];
    const failed: string[] = [];

    console.log(`[OrphanManager] Deleting ${speFileIds.length} orphaned files`);

    for (const id of speFileIds) {
      try {
        const success = await sharepointFileStorage.deleteFile(id, tenantId);
        if (success) {
          deleted.push(id);
          console.log(`[OrphanManager] Deleted orphan: ${id}`);
        } else {
          failed.push(id);
          console.warn(`[OrphanManager] Delete returned false for: ${id}`);
        }
      } catch (err) {
        failed.push(id);
        console.error(`[OrphanManager] Delete failed for ${id}:`, err instanceof Error ? err.message : err);
      }
    }

    console.log(`[OrphanManager] Deleted ${deleted.length}, failed ${failed.length}`);
    return { deletedCount: deleted.length, failedCount: failed.length, deletedFileIds: deleted, failedFileIds: failed };
  }

  /**
   * Full orphan cleanup pipeline: scan → report → optionally delete.
   *
   * @param options.dryRun    When true (default), only report — do NOT delete
   * @param options.tenantId  Scope to a specific Orbit tenant
   * @param options.maxDelete Safety cap on number of deletions per run
   */
  async runOrphanCleanup(options: {
    dryRun?: boolean;
    tenantId?: string;
    maxDelete?: number;
  } = {}): Promise<OrphanCleanupResult> {
    const { dryRun = true, tenantId, maxDelete = 100 } = options;

    const scan = await this.scanForOrphans(tenantId);

    if (dryRun || scan.orphanCount === 0) {
      console.log(
        `[OrphanManager] ${dryRun ? "Dry run" : "No orphans"} — skipping deletion. ` +
        `Orphans found: ${scan.orphanCount}`
      );
      return {
        ...scan,
        dryRun,
        deletedCount: 0,
        failedCount: 0,
        deletedFileIds: [],
        failedFileIds: [],
      };
    }

    const toDelete = scan.orphans
      .slice(0, maxDelete);

    if (scan.orphanCount > maxDelete) {
      console.warn(
        `[OrphanManager] ${scan.orphanCount} orphans found but capped at ${maxDelete} deletions per run`
      );
    }

    // Group by orbitTenantId so each deletion is routed to the correct container.
    // Orphans with no orbitTenantId (global container) are keyed on undefined,
    // which causes deleteOrphans() to resolve via getContainerForTenant(undefined)
    // — the correct fallback to the global default container.
    const byTenant = new Map<string | undefined, string[]>();
    for (const orphan of toDelete) {
      const tid = orphan.orbitTenantId ?? tenantId;
      if (!byTenant.has(tid)) byTenant.set(tid, []);
      byTenant.get(tid)!.push(orphan.speFileId);
    }

    const deletedFileIds: string[] = [];
    const failedFileIds: string[] = [];

    for (const [tid, ids] of byTenant) {
      const result = await this.deleteOrphans(ids, tid);
      deletedFileIds.push(...result.deletedFileIds);
      failedFileIds.push(...result.failedFileIds);
    }

    return {
      ...scan,
      dryRun: false,
      deletedCount: deletedFileIds.length,
      failedCount: failedFileIds.length,
      deletedFileIds,
      failedFileIds,
    };
  }

  /**
   * Lightweight summary for the admin dashboard (no file listing).
   */
  async getOrphanReport(tenantId?: string): Promise<{
    orphanCount: number;
    totalSpeFiles: number;
    totalDbFiles: number;
    estimatedOrphanBytes: number;
    oldestOrphan: Date | null;
    scannedAt: Date;
  }> {
    const scan = await this.scanForOrphans(tenantId);
    const totalBytes = scan.orphans.reduce((s, o) => s + o.size, 0);
    const oldest = scan.orphans.length > 0
      ? new Date(Math.min(...scan.orphans.map((o) => o.uploadedAt.getTime())))
      : null;

    return {
      orphanCount: scan.orphanCount,
      totalSpeFiles: scan.totalFilesInSpe,
      totalDbFiles: scan.totalFilesInDb,
      estimatedOrphanBytes: totalBytes,
      oldestOrphan: oldest,
      scannedAt: scan.scannedAt,
    };
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Return the Orbit tenant UUIDs of every tenant that has SPE storage enabled.
   */
  private async getSpeEnabledTenantIds(): Promise<string[]> {
    const rows = await db
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.speStorageEnabled, true));
    return rows.map((r) => r.id);
  }

  /**
   * Build a Set of all speFileIds currently tracked in the database.
   * Queries both grounding_documents and global_grounding_documents tables.
   */
  private async loadKnownSpeFileIds(containerId: string): Promise<Set<string>> {
    const ids = new Set<string>();

    // Tenant grounding documents — scoped to this container
    const tenantDocs = await db
      .select({ speFileId: groundingDocuments.speFileId })
      .from(groundingDocuments)
      .where(
        and(
          isNotNull(groundingDocuments.speFileId),
          eq(groundingDocuments.speContainerId, containerId)
        )
      );

    for (const row of tenantDocs) {
      if (row.speFileId) ids.add(row.speFileId);
    }

    // Global grounding documents — scoped to this container
    const globalDocs = await db
      .select({ speFileId: globalGroundingDocuments.speFileId })
      .from(globalGroundingDocuments)
      .where(
        and(
          isNotNull(globalGroundingDocuments.speFileId),
          eq(globalGroundingDocuments.speContainerId, containerId)
        )
      );

    for (const row of globalDocs) {
      if (row.speFileId) ids.add(row.speFileId);
    }

    return ids;
  }
}

export const orphanedFileManager = new OrphanedFileManager();
