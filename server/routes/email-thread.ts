import type { Express } from "express";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { outreachCampaigns, prospects, marketingContacts } from "@shared/schema";
import { emailThreadParseSchema } from "@shared/email-thread";
import { ContextError, getRequestContext } from "../context";
import { guardFeature, logAiUsage } from "./helpers";
import { EmailThreadError, parseEmailThread } from "../services/email-thread-parser";
import { emailThreadContact, saveEmailThread } from "../services/email-thread-service";
import { signThreadLocation } from "../services/email-thread-location";

const active = new Set<string>();
const recent = new Map<string, number[]>();
export function registerEmailThreadRoutes(app: Express) {
  for (const operation of ["parse", "save", "contact"] as const) {
    app[operation === "contact" ? "get" : "post"](`/api/sales-outreach/campaigns/:id/email-thread/${operation}`, async (req, res) => {
      let key: string | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        if (!(await guardFeature(req, res, "salesOutreachCampaigns"))) return;
        const ctx = await getRequestContext(req);
        if (!["Analyst", "Domain Admin", "Global Admin"].includes(ctx.userRole)) return res.status(403).json({ error: "Your role cannot import email threads." });
        const [campaign] = await db.select().from(outreachCampaigns).where(and(eq(outreachCampaigns.id, req.params.id), eq(outreachCampaigns.tenantDomain, ctx.tenantDomain)));
        if (!campaign || (campaign.marketId && campaign.marketId !== ctx.marketId)) return res.status(404).json({ error: "Campaign not found." });
        res.setHeader("Cache-Control", "no-store");
        if (operation === "contact") {
          const id = z.string().min(1).max(100).parse(req.query.prospectId);
          return res.json(await emailThreadContact(ctx.tenantDomain, campaign.id, id, ctx.marketId, ctx.userId));
        }
        if (operation === "save") return res.json(await saveEmailThread(ctx.tenantDomain, ctx.marketId, ctx.userId, campaign.id, req.body));
        const input = emailThreadParseSchema.parse(req.body);
        if (input.prospectId) await emailThreadContact(ctx.tenantDomain, campaign.id, input.prospectId);
        const candidateKey = `${ctx.tenantDomain}:${ctx.userId}`;
        const now = Date.now();
        for (const [k, values] of recent) if (!values.some(t => t > now - 60000)) recent.delete(k);
        const times = (recent.get(candidateKey) ?? []).filter(t => t > now - 60000);
        if (active.has(candidateKey) || times.length >= 5) return res.status(429).json({ error: "Please wait before parsing another thread." });
        active.add(candidateKey); key = candidateKey; recent.set(key, [...times, now]);
        const work = parseEmailThread(ctx.tenantDomain, input.text);
        // Keep the provider slot until the actual call settles, even after an HTTP timeout.
        const ownedKey = key;
        void work.then(() => active.delete(ownedKey), () => active.delete(ownedKey));
        key = undefined;
        const result = await Promise.race([
          work,
          new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new EmailThreadError("Analysis took too long. Try a shorter section of the thread.", 504)), 60000); }),
        ]);
        const rows = await db.select({ id: prospects.id, email: marketingContacts.email, linkedinUrl: marketingContacts.linkedinUrl, removedAt: prospects.removedAt }).from(prospects)
          .innerJoin(marketingContacts, and(eq(marketingContacts.id, prospects.contactId), eq(marketingContacts.tenantDomain, ctx.tenantDomain)))
          .where(and(eq(prospects.campaignId, campaign.id), eq(prospects.tenantDomain, ctx.tenantDomain)));
        const contacts = result.contacts.map(c => {
          const matches = rows.filter(r => !r.removedAt && ((c.email && c.email.toLowerCase() === r.email?.toLowerCase()) || (c.linkedinUrl && c.linkedinUrl === r.linkedinUrl)));
          return { ...c, ...(matches.length === 1 ? { matchedProspectId: matches[0].id } : {}) };
        });
        await logAiUsage(ctx, "parseEmailThread", result.completion.provider, result.completion.model, {
          input_tokens: result.completion.usage.inputTokens, output_tokens: result.completion.usage.outputTokens,
        }, result.completion.durationMs);
        const scope = { tenantDomain: ctx.tenantDomain, marketId: ctx.marketId, userId: ctx.userId, campaignId: campaign.id };
        const meetingLocations = (result.meetingLocations ?? []).map(suggestion => ({
          ...suggestion, ...(suggestion.status === "current" ? { token: signThreadLocation(scope, suggestion) } : {}),
        }));
        return res.json({ contacts, meetingTimes: result.meetingTimes, meetingLocations, warnings: result.warnings });
      } catch (error) {
        if (error instanceof ContextError || error instanceof EmailThreadError) return res.status(error.status).json({ error: error.message });
        if (error instanceof z.ZodError) return res.status(400).json({ error: "Check the selected contact, fields, meeting proposals and confirmation." });
        // Neither raw provider errors nor pasted correspondence belongs in logs.
        res.status(502).json({ error: "Could not process the email thread. Your pasted text is still available to retry." });
      } finally { if (timer) clearTimeout(timer); if (key) active.delete(key); }
    });
  }
}
