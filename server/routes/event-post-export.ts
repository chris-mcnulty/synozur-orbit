import type { Express, Request } from "express";
import { z } from "zod";
import { getRequestContext } from "../context";
import { guardFeature } from "./helpers";
import { storeArtifact } from "../services/artifact-storage-helper";
import {
  eventExportSelection, eventExportRequest, EventExportError,
  previewEventExport, exportEventPosts, confirmEventExport,
} from "../services/event-post-export";

export function eventExportBaseUrl(req: Request) {
  const proto = req.headers["x-forwarded-proto"] || req.protocol;
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return process.env.PUBLIC_APP_URL?.replace(/\/+$/, "") || (host ? `${proto}://${host}` : undefined);
}

export function registerEventPostExportRoutes(app: Express) {
  app.post("/api/conferences/export-preview", async (req, res) => {
    if (!(await guardFeature(req, res, "conferencePromotion"))) return;
    try {
      const selection = eventExportSelection.parse(req.body);
      const ctx = await getRequestContext(req);
      res.json(await previewEventExport(ctx, selection));
    } catch (err) { respondError(res, err); }
  });
  app.post("/api/conferences/export-csv", async (req, res) => {
    if (!(await guardFeature(req, res, "conferencePromotion"))) return;
    try {
      const { format, tzOffset, ...selection } = eventExportRequest.parse(req.body);
      const ctx = await getRequestContext(req);
      const result = await exportEventPosts(ctx, selection, { format, tzOffset, imageBaseUrl: eventExportBaseUrl(req) });
      try {
        await storeArtifact({
          tenantDomain: ctx.tenantDomain, buffer: Buffer.from(result.csv, "utf8"),
          filename: `events-${format}-${new Date().toISOString().slice(0, 10)}.csv`,
          mimeType: "text/csv", kind: "csv", marketId: ctx.marketId, createdByUserId: ctx.userId,
        });
      } catch (err) {
        console.warn("[event-post-export] Could not retain export artifact:", err instanceof Error ? err.message : "Unknown error");
      }
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="events-${format}.csv"`);
      res.setHeader("Access-Control-Expose-Headers", "X-Exported-Post-Ids");
      res.setHeader("X-Exported-Post-Ids", result.postIds.join(","));
      res.send(result.csv);
    } catch (err) { respondError(res, err); }
  });
  app.post("/api/conferences/mark-export-delivered", async (req, res) => {
    if (!(await guardFeature(req, res, "conferencePromotion"))) return;
    try {
      const { postIds, ...selection } = eventExportSelection.extend({
        postIds: z.array(z.string().min(1).max(100)).min(1).max(20000),
      }).parse(req.body);
      const ctx = await getRequestContext(req);
      res.json(await confirmEventExport(ctx, selection, postIds));
    } catch (err) { respondError(res, err); }
  });
}

function respondError(res: import("express").Response, err: unknown) {
  if (err instanceof z.ZodError) return res.status(400).json({ error: "Choose valid events, accounts, and export options." });
  if (err instanceof EventExportError) return res.status(err.status).json({ error: err.message });
  console.error("[event-post-export]", err instanceof Error ? err.message : "Unknown error");
  return res.status(500).json({ error: "Could not process the event export." });
}
