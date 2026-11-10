import type { Express } from "express";
import { ContextError, getRequestContext } from "../context";
import { guardFeature, logAiUsage } from "./helpers";
import { getCampaign } from "../services/outreach-interview-service";
import { ContactParseError, parseRoughContacts, roughContactInput } from "../services/rough-contact-parser";

// Bound concurrent AI work and accidental repeat clicks without storing pasted text.
const active = new Set<string>();
const recent = new Map<string, number[]>();

export function registerRoughContactImportRoutes(app: Express) {
  app.post("/api/sales-outreach/campaigns/:id/parse-contacts", async (req, res) => {
    let key: string | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let ownsSlot = false;
    try {
      if (!(await guardFeature(req, res, "salesOutreachCampaigns"))) return;
      const ctx = await getRequestContext(req);
      const campaign = await getCampaign(ctx.tenantDomain, req.params.id);
      if (!campaign) return res.status(404).json({ error: "Campaign not found" });
      const input = roughContactInput.safeParse(req.body);
      if (!input.success) return res.status(400).json({ error: input.error.issues[0]?.message || "Invalid pasted text" });
      key = `${ctx.tenantDomain}:${ctx.userId}`;
      const now = Date.now();
      for (const [id, times] of recent) if (!times.some(time => time > now - 60000)) recent.delete(id);
      const times = (recent.get(key) || []).filter(time => time > now - 60000);
      if (active.has(key) || times.length >= 5) {
        return res.status(429).json({ error: "Please wait before extracting contacts again." });
      }
      active.add(key);
      ownsSlot = true;
      recent.set(key, [...times, now]);
      const result = await Promise.race([
        parseRoughContacts(ctx.tenantDomain, input.data.text),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new ContactParseError("Extraction took too long. Try a smaller text selection.")), 60000);
        }),
      ]);
      await logAiUsage(ctx, "parseCampaignContacts", result.completion.provider, result.completion.model, {
        input_tokens: result.completion.usage.inputTokens,
        output_tokens: result.completion.usage.outputTokens,
      }, result.completion.durationMs);
      // Preview only: importing requires a separate, explicit reviewed request.
      res.json({ contacts: result.contacts, warnings: result.warnings });
    } catch (err) {
      if (err instanceof ContextError) return res.status(err.status).json({ error: err.message });
      if (err instanceof ContactParseError) return res.status(422).json({ error: err.message });
      // Do not log raw provider errors: they can contain pasted personal data.
      res.status(502).json({ error: "Could not extract contacts right now. Please try again." });
    } finally {
      if (timer) clearTimeout(timer);
      if (ownsSlot && key) active.delete(key);
    }
  });
}
