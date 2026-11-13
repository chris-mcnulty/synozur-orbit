import type { Express, Request, Response } from "express";
import { z } from "zod";
import { ContextError, getRequestContext } from "../context";
import { guardFeature } from "./helpers";
import { completeOutreachNextStep, loadOutreachWorkspace, OutreachWorkspaceError } from "../services/outreach-workspace-service";

export function registerOutreachWorkspaceRoutes(app: Express) {
  const handle = (fn: (req: Request, res: Response, ctx: Awaited<ReturnType<typeof getRequestContext>>) => Promise<void>, write = false) =>
    async (req: Request, res: Response) => {
      try {
        if (!(await guardFeature(req, res, "salesOutreachCampaigns"))) return;
        const ctx = await getRequestContext(req);
        if (write && !["Analyst", "Domain Admin", "Global Admin"].includes(ctx.userRole)) {
          res.status(403).json({ error: "Your role cannot mark campaign next steps done." }); return;
        }
        await fn(req, res, ctx);
      } catch (error) {
        if (error instanceof z.ZodError) { res.status(400).json({ error: error.issues.map(issue => issue.message).join("; ") }); return; }
        if (error instanceof ContextError || error instanceof OutreachWorkspaceError) {
          res.status(error.status).json({ error: error.message }); return;
        }
        console.error("[outreach-workspace]", error instanceof Error ? error.name : "Unknown error");
        res.status(500).json({ error: "Could not update or load the campaign workspace. Please retry." });
      }
    };
  for (const path of ["next-steps", "summary"] as const) {
    app[path === "summary" ? "post" : "get"](`/api/sales-outreach/campaigns/:id/${path}`, handle(async (req, res, ctx) => {
      const result = await loadOutreachWorkspace(ctx.tenantDomain, ctx.marketId, req.params.id);
      res.setHeader("Cache-Control", "no-store");
      res.json(result);
    }));
  }
  app.patch("/api/sales-outreach/campaigns/:id/next-steps/completion", handle(async (req, res, ctx) => {
    const input = z.object({
      prospectId: z.string().min(1).max(100), itemId: z.string().min(1).max(500),
      version: z.string().regex(/^[a-f0-9]{64}$/), completed: z.boolean(),
    }).strict().parse(req.body);
    res.json(await completeOutreachNextStep(ctx.tenantDomain, ctx.marketId, ctx.userId, req.params.id, input));
  }, true));
}
