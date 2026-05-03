import type { Express } from "express";
import { UploadedFile } from "express-fileupload";
import { storage } from "../storage";
import { getRequestContext, ContextError } from "../context";
import { validateResourceContext, guardFeature } from "./helpers";
import { validateDocumentUpload } from "../utils/file-validator";
import { documentExtractionService } from "../services/document-extraction";
import { sharepointFileStorage } from "../services/sharepoint-file-storage";
import { insertCompetitorDocumentSchema, type CompetitorDocument } from "@shared/schema";
import { fromError } from "zod-validation-error";
import { z } from "zod";
import { enqueueMonitor } from "../services/job-queue";

const SYNC_EXTRACTION_THRESHOLD_BYTES = 2 * 1024 * 1024;
// Shared per-tenant document storage cap. Counts BOTH company grounding
// docs (fileSize) and ALL competitor docs (active + archived byteSize)
// since archived files still occupy SPE storage until hard-deleted.
const TENANT_DOC_STORAGE_QUOTA_BYTES = 5 * 1024 * 1024 * 1024; // 5 GB

function fileTypeFromMime(mime: string, filename: string): string {
  if (mime === "application/pdf") return "pdf";
  if (mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return "docx";
  if (mime === "application/msword") return "doc";
  if (mime === "text/plain") return "txt";
  const ext = filename.split(".").pop()?.toLowerCase();
  return ext || "bin";
}

const updateDocumentSchema = z.object({
  displayTitle: z.string().min(1).max(255).optional(),
  scopeTag: z.string().max(100).nullable().optional(),
  status: z.enum(["active", "archived"]).optional(),
});

export function registerCompetitorDocumentRoutes(app: Express) {
  // List documents for a competitor (read-only — no plan gate so Free/Trial
  // users can still view existing uploads after a downgrade)
  app.get("/api/competitors/:competitorId/documents", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      const competitor = await storage.getCompetitor(req.params.competitorId);
      if (!competitor) return res.status(404).json({ error: "Competitor not found" });
      if (!validateResourceContext(competitor, ctx)) {
        return res.status(403).json({ error: "Access denied" });
      }
      const includeArchived = req.query.includeArchived === "true";
      const allDocs = await storage.getCompetitorDocumentsByCompetitor(req.params.competitorId, includeArchived);
      // Defense-in-depth: filter to docs that match the request market
      const docs = allDocs.filter((d) => validateResourceContext(d, ctx));
      // Resolve uploader display names for the UI (de-dup by user id).
      const uploaderIds = Array.from(new Set(docs.map((d) => d.uploadedByUserId).filter(Boolean)));
      const uploaderMap = new Map<string, string>();
      await Promise.all(
        uploaderIds.map(async (uid) => {
          const u = await storage.getUser(uid);
          if (u) uploaderMap.set(uid, u.name || u.email || "Unknown");
        }),
      );
      const slim = docs.map(({ extractedText, ...rest }) => ({
        ...rest,
        hasExtractedText: !!extractedText,
        uploadedByName: uploaderMap.get(rest.uploadedByUserId) || "Unknown",
      }));
      res.json(slim);
    } catch (error: any) {
      if (error instanceof ContextError) return res.status(error.status).json({ error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  // Upload a new document (multipart)
  app.post("/api/competitors/:competitorId/documents", async (req, res) => {
    if (!await guardFeature(req, res, "competitorDocuments")) return;
    try {
      const ctx = await getRequestContext(req);
      const competitor = await storage.getCompetitor(req.params.competitorId);
      if (!competitor) return res.status(404).json({ error: "Competitor not found" });
      if (!validateResourceContext(competitor, ctx)) {
        return res.status(403).json({ error: "Access denied" });
      }

      const files = req.files;
      if (!files || !files.file) {
        return res.status(400).json({ error: "No file uploaded (expected field 'file')" });
      }
      const file = files.file as UploadedFile;
      const validation = validateDocumentUpload(file);
      if (!validation.isValid) {
        return res.status(400).json({ error: validation.error });
      }

      const displayTitle = (typeof req.body?.displayTitle === "string" && req.body.displayTitle.trim())
        || file.name;
      const scopeTag = typeof req.body?.scopeTag === "string" && req.body.scopeTag.trim()
        ? req.body.scopeTag.trim().slice(0, 100)
        : null;

      const fileType = fileTypeFromMime(file.mimetype, file.name);

      // Shared tenant storage quota: sum bytes used by company grounding
      // docs + all competitor docs (active + archived).
      const [existingCompetitorDocs, existingGroundingDocs] = await Promise.all([
        storage.getCompetitorDocumentsByTenant(ctx.tenantDomain),
        storage.getGroundingDocumentsByTenant(ctx.tenantDomain),
      ]);
      const usedBytes =
        existingCompetitorDocs.reduce((sum, d) => sum + (d.byteSize || 0), 0) +
        existingGroundingDocs.reduce((sum, d) => sum + (d.fileSize || 0), 0);
      if (usedBytes + file.size > TENANT_DOC_STORAGE_QUOTA_BYTES) {
        return res.status(413).json({
          error: `Tenant document storage quota exceeded (${(TENANT_DOC_STORAGE_QUOTA_BYTES / (1024 * 1024 * 1024)).toFixed(0)} GB total across grounding library and competitor uploads). Permanently delete older documents to free space.`,
        });
      }

      // Persist DB row first so we have an id to use as SPE filename prefix
      const tenant = await storage.getTenantByDomain(ctx.tenantDomain);
      const insertData = insertCompetitorDocumentSchema.parse({
        tenantDomain: ctx.tenantDomain,
        marketId: ctx.marketId ?? null,
        competitorId: competitor.id,
        fileName: validation.sanitizedFilename || file.name,
        displayTitle,
        scopeTag,
        objectStoragePath: null,
        speFileId: null,
        speContainerId: null,
        byteSize: file.size,
        mimeType: file.mimetype,
        fileType,
        extractedText: null,
        status: "active",
        uploadedByUserId: ctx.userId,
      });

      const doc = await storage.createCompetitorDocument(insertData);

      // Upload to SharePoint Embedded
      try {
        const stored = await sharepointFileStorage.storeFile(
          file.data,
          validation.sanitizedFilename || file.name,
          file.mimetype,
          {
            documentType: "grounding_document",
            scope: "competitor",
            tenantDomain: ctx.tenantDomain,
            marketId: ctx.marketId ?? undefined,
            competitorId: competitor.id,
            createdByUserId: ctx.userId,
            fileType,
            originalFileName: file.name,
          },
          ctx.userId,
          doc.id,
          tenant?.id,
        );
        await storage.updateCompetitorDocument(doc.id, {
          speFileId: stored.id,
          objectStoragePath: `tenants/${ctx.tenantDomain}/competitors/${competitor.id}/documents/${stored.id}`,
        });
        doc.speFileId = stored.id;
      } catch (uploadErr: any) {
        console.error("[CompetitorDocs] Upload failed, removing DB row:", uploadErr?.message || uploadErr);
        await storage.deleteCompetitorDocument(doc.id);
        return res.status(500).json({ error: `File upload failed: ${uploadErr?.message || "unknown"}` });
      }

      // Extract text — sync for small docs, fire-and-forget for larger
      const runExtraction = async () => {
        try {
          let text = "";
          if (file.mimetype === "text/plain") {
            text = file.data.toString("utf-8");
          } else if (fileType === "pdf") {
            text = await documentExtractionService.extractFromPdf(file.data);
          } else if (fileType === "docx") {
            text = await documentExtractionService.extractFromDocx(file.data);
          } else if (fileType === "doc") {
            text = "[Note: .doc format text extraction not available. Please convert to .docx or PDF]";
          }
          if (text) {
            await storage.updateCompetitorDocumentText(doc.id, text.slice(0, 1_000_000));
          }
        } catch (err) {
          console.error(`[CompetitorDocs] Text extraction failed for ${doc.id}:`, err);
        }
      };

      if (file.size <= SYNC_EXTRACTION_THRESHOLD_BYTES) {
        await runExtraction();
      } else {
        // Durable extraction job for large uploads
        enqueueMonitor(
          `competitor-doc-extract:${doc.id}`,
          () => runExtraction(),
          5 * 60 * 1000,
          { tenantDomain: ctx.tenantDomain },
        ).catch((err) => console.error("[CompetitorDocs] Queue extraction failed:", err));
      }

      // Activity log
      try {
        await storage.createActivity({
          type: "competitor_document_uploaded",
          sourceType: "competitor",
          competitorId: competitor.id,
          competitorName: competitor.name,
          description: `Uploaded "${displayTitle}"${scopeTag ? ` (${scopeTag})` : ""}`,
          date: new Date().toLocaleString(),
          impact: "Low",
          userId: ctx.userId,
          tenantDomain: ctx.tenantDomain,
          marketId: ctx.marketId,
        });
      } catch (err) {
        console.error("[CompetitorDocs] Activity log failed:", err);
      }

      // Re-read latest row (with extracted text and spe id)
      const finalDoc = await storage.getCompetitorDocument(doc.id);
      res.json(finalDoc);
    } catch (error: any) {
      if (error instanceof ContextError) return res.status(error.status).json({ error: error.message });
      console.error("[CompetitorDocs] Upload error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Patch a document (rename, change tag, archive/unarchive)
  app.patch("/api/competitors/:competitorId/documents/:docId", async (req, res) => {
    if (!await guardFeature(req, res, "competitorDocuments")) return;
    try {
      const ctx = await getRequestContext(req);
      const doc = await storage.getCompetitorDocument(req.params.docId);
      if (!doc) return res.status(404).json({ error: "Document not found" });
      const competitorForCtx = await storage.getCompetitor(req.params.competitorId);
      if (
        !competitorForCtx ||
        !validateResourceContext(competitorForCtx, ctx) ||
        doc.tenantDomain !== ctx.tenantDomain ||
        doc.competitorId !== req.params.competitorId ||
        !validateResourceContext(doc, ctx)
      ) {
        return res.status(403).json({ error: "Access denied" });
      }

      const parsed = updateDocumentSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: fromError(parsed.error).toString() });
      }

      const data = parsed.data;
      // Status transitions go through dedicated archive/unarchive helpers
      if (data.status && data.status !== doc.status) {
        if (data.status === "archived") {
          await storage.archiveCompetitorDocument(doc.id);
          const competitorForActivity = await storage.getCompetitor(doc.competitorId);
          await storage.createActivity({
            type: "competitor_document_archived",
            sourceType: "competitor",
            competitorId: doc.competitorId,
            competitorName: competitorForActivity?.name || "",
            description: `Archived "${doc.displayTitle}"`,
            date: new Date().toLocaleString(),
            impact: "Low",
            userId: ctx.userId,
            tenantDomain: ctx.tenantDomain,
            marketId: ctx.marketId,
          }).catch(() => {});
        } else if (data.status === "active") {
          await storage.unarchiveCompetitorDocument(doc.id);
        }
      }

      const updates: Partial<{ displayTitle: string; scopeTag: string | null }> = {};
      if (data.displayTitle !== undefined) updates.displayTitle = data.displayTitle;
      if (data.scopeTag !== undefined) updates.scopeTag = data.scopeTag;
      if (Object.keys(updates).length > 0) {
        await storage.updateCompetitorDocument(doc.id, updates);
      }

      const updated = await storage.getCompetitorDocument(doc.id);
      res.json(updated);
    } catch (error: any) {
      if (error instanceof ContextError) return res.status(error.status).json({ error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  // Delete = soft-delete (archive). Use ?hard=true to permanently purge
  // (admins only — guarded by feature flag and tenant scope).
  app.delete("/api/competitors/:competitorId/documents/:docId", async (req, res) => {
    // All mutations (soft-delete/archive AND hard-delete) require the plan
    // feature; Free/Trial users get view-only access.
    if (!await guardFeature(req, res, "competitorDocuments")) return;
    try {
      const ctx = await getRequestContext(req);
      const doc = await storage.getCompetitorDocument(req.params.docId);
      if (!doc) return res.status(404).json({ error: "Document not found" });
      const competitorForCtx = await storage.getCompetitor(req.params.competitorId);
      if (
        !competitorForCtx ||
        !validateResourceContext(competitorForCtx, ctx) ||
        doc.tenantDomain !== ctx.tenantDomain ||
        doc.competitorId !== req.params.competitorId ||
        !validateResourceContext(doc, ctx)
      ) {
        return res.status(403).json({ error: "Access denied" });
      }

      const hard = req.query.hard === "true";

      if (hard) {
        if (doc.speFileId) {
          try {
            const tenant = await storage.getTenantByDomain(ctx.tenantDomain);
            await sharepointFileStorage.deleteFile(doc.speFileId, tenant?.id);
          } catch (err) {
            console.error("[CompetitorDocs] SPE delete failed:", err);
          }
        }
        await storage.deleteCompetitorDocument(doc.id);
        return res.json({ success: true, hardDeleted: true });
      }

      // Soft-delete by archiving — keeps the row + SPE file for restore
      await storage.archiveCompetitorDocument(doc.id);
      const competitor = await storage.getCompetitor(doc.competitorId);
      storage.createActivity({
        type: "competitor_document_archived",
        sourceType: "competitor",
        competitorId: doc.competitorId,
        competitorName: competitor?.name || "",
        description: `Archived "${doc.displayTitle}"`,
        date: new Date().toLocaleString(),
        impact: "Low",
        userId: ctx.userId,
        tenantDomain: ctx.tenantDomain,
        marketId: ctx.marketId,
      }).catch(() => {});
      res.json({ success: true, archived: true });
    } catch (error: any) {
      if (error instanceof ContextError) return res.status(error.status).json({ error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  // Preview — return extracted text + metadata for in-app viewing
  app.get("/api/competitors/:competitorId/documents/:docId/preview", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      const doc = await storage.getCompetitorDocument(req.params.docId);
      if (!doc) return res.status(404).json({ error: "Document not found" });
      const competitorForCtx = await storage.getCompetitor(req.params.competitorId);
      if (
        !competitorForCtx ||
        !validateResourceContext(competitorForCtx, ctx) ||
        doc.tenantDomain !== ctx.tenantDomain ||
        doc.competitorId !== req.params.competitorId ||
        !validateResourceContext(doc, ctx)
      ) {
        return res.status(403).json({ error: "Access denied" });
      }
      res.json({
        id: doc.id,
        displayTitle: doc.displayTitle,
        scopeTag: doc.scopeTag,
        fileType: doc.fileType,
        mimeType: doc.mimeType,
        byteSize: doc.byteSize,
        status: doc.status,
        uploadedAt: doc.uploadedAt,
        // Cap preview at ~80KB of text to keep client payload small
        extractedText: doc.extractedText ? doc.extractedText.slice(0, 80_000) : null,
        extractedTextTruncated: !!doc.extractedText && doc.extractedText.length > 80_000,
      });
    } catch (error: any) {
      if (error instanceof ContextError) return res.status(error.status).json({ error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  // Inline preview — same content as download but rendered inline (used by
  // the in-app PDF viewer). Strict tenant + market + competitor scoping.
  app.get("/api/competitors/:competitorId/documents/:docId/inline", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      const doc = await storage.getCompetitorDocument(req.params.docId);
      if (!doc) return res.status(404).json({ error: "Document not found" });
      const competitorForCtx = await storage.getCompetitor(req.params.competitorId);
      if (
        !competitorForCtx ||
        !validateResourceContext(competitorForCtx, ctx) ||
        doc.tenantDomain !== ctx.tenantDomain ||
        doc.competitorId !== req.params.competitorId ||
        !validateResourceContext(doc, ctx)
      ) {
        return res.status(403).json({ error: "Access denied" });
      }
      if (!doc.speFileId) return res.status(404).json({ error: "File content not available" });
      const tenant = await storage.getTenantByDomain(ctx.tenantDomain);
      const result = await sharepointFileStorage.getFileContent(doc.speFileId, tenant?.id);
      if (!result) return res.status(404).json({ error: "File not found in storage" });
      res.setHeader("Content-Type", doc.mimeType);
      res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(doc.fileName)}"`);
      res.setHeader("Content-Length", String(result.buffer.length));
      res.send(result.buffer);
    } catch (error: any) {
      if (error instanceof ContextError) return res.status(error.status).json({ error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  // Download — proxy through the server with strict tenant + market check
  app.get("/api/competitors/:competitorId/documents/:docId/download", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      const doc = await storage.getCompetitorDocument(req.params.docId);
      if (!doc) return res.status(404).json({ error: "Document not found" });
      const competitorForCtx = await storage.getCompetitor(req.params.competitorId);
      if (
        !competitorForCtx ||
        !validateResourceContext(competitorForCtx, ctx) ||
        doc.tenantDomain !== ctx.tenantDomain ||
        doc.competitorId !== req.params.competitorId ||
        !validateResourceContext(doc, ctx)
      ) {
        return res.status(403).json({ error: "Access denied" });
      }
      if (!doc.speFileId) {
        return res.status(404).json({ error: "File content not available" });
      }
      const tenant = await storage.getTenantByDomain(ctx.tenantDomain);
      const result = await sharepointFileStorage.getFileContent(doc.speFileId, tenant?.id);
      if (!result) return res.status(404).json({ error: "File not found in storage" });

      // Activity log (best-effort)
      storage.createActivity({
        type: "competitor_document_downloaded",
        sourceType: "competitor",
        competitorId: doc.competitorId,
        competitorName: req.params.competitorId,
        description: `Downloaded "${doc.displayTitle}"`,
        date: new Date().toLocaleString(),
        impact: "Low",
        userId: ctx.userId,
        tenantDomain: ctx.tenantDomain,
        marketId: ctx.marketId,
      }).catch(() => {});

      res.setHeader("Content-Type", doc.mimeType);
      res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(doc.fileName)}"`);
      res.setHeader("Content-Length", String(result.buffer.length));
      res.send(result.buffer);
    } catch (error: any) {
      if (error instanceof ContextError) return res.status(error.status).json({ error: error.message });
      console.error("[CompetitorDocs] Download error:", error);
      res.status(500).json({ error: error.message });
    }
  });
}
