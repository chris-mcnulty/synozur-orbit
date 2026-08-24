/**
 * Quick Generate — one free-text prompt → campaign content, grounded strictly
 * in the prompt (no interview/concept rewriting, no invented strategy).
 *
 * Two endpoints:
 *   POST /api/quick-generate/angles — optional angles-first step: 6-8
 *     candidate takes on the prompt with honest fit assessments.
 *   POST /api/quick-generate — fan out to the requested deliverables (social
 *     posts, blog post as content brief + drafted asset, newsletter email
 *     draft), each linked to an existing or newly created campaign. Partial
 *     failures return per-deliverable results rather than all-or-nothing.
 */

import type { Express } from "express";
import { db } from "../db";
import {
  campaigns,
  contentBriefs,
  contentAssets,
  generatedPosts,
  generatedEmails,
  editorialCalendars,
  tenantFonts,
  tenants,
} from "@shared/schema";
import { and, eq } from "drizzle-orm";
import { randomBytes, randomUUID } from "crypto";
import { getRequestContext } from "../context";
import { guardFeature, guardManualAction } from "./helpers";
import {
  generateQuickAngles,
  quickDraftBlog,
  quickDraftNewsletter,
  quickDraftSocialPosts,
} from "../services/quick-generate-service";
import {
  coerceDeliverables,
  deriveCampaignNameFromPrompt,
  normalizeQuickAngle,
  signQuickAngle,
  verifyQuickAngleToken,
  type QuickAngle,
  type QuickDeliverable,
} from "../services/quick-generate-core";
import { coercePlatform, type RepurposePlatform } from "../services/repurpose-core";
import { DEFAULT_FUNNEL_TARGETS } from "../services/editorial-calendar-core";
import {
  buildFontStack,
  CURATED_EMAIL_FONTS,
  enforceMinimumFontSize,
  normalizeFontFamily,
} from "../services/email-campaign-sender";
import { renderQuickNewsletterHtml } from "../services/quick-newsletter-layout";

const MIN_PROMPT_LENGTH = 12;
const MAX_PROMPT_LENGTH = 5000;

function readPrompt(body: any): string | null {
  const s = typeof body?.prompt === "string" ? body.prompt.trim() : "";
  if (s.length < MIN_PROMPT_LENGTH || s.length > MAX_PROMPT_LENGTH) return null;
  return s;
}

/** Feature gate per deliverable — matches the surfaces the items land in. */
const DELIVERABLE_FEATURE: Record<QuickDeliverable, string> = {
  social: "socialPosts",
  blog: "editorialCalendar",
  newsletter: "emailNewsletters",
};

// Secret for angle tokens. Angles are signed by the angles endpoint and
// verified by the drafting endpoint so a client cannot hand-edit an angle
// into a fact-injection vector. Falls back to a per-process secret when
// SESSION_SECRET is unset (angles then only verify within one process).
const processAngleSecret = randomBytes(32).toString("hex");
function angleSecret(): string {
  return process.env.SESSION_SECRET || processAngleSecret;
}

export function registerQuickGenerateRoutes(app: Express) {
  app.post("/api/quick-generate/angles", async (req, res) => {
    try {
      if (!(await guardFeature(req, res, "campaigns"))) return;
      const ctx = await getRequestContext(req);

      const prompt = readPrompt(req.body);
      if (!prompt) {
        return res.status(400).json({
          error: `Provide a prompt between ${MIN_PROMPT_LENGTH} and ${MAX_PROMPT_LENGTH} characters.`,
        });
      }

      const { angles, model } = await generateQuickAngles({
        tenantDomain: ctx.tenantDomain,
        marketId: ctx.marketId,
        isDefaultMarket: ctx.isDefaultMarket,
        prompt,
      });
      if (angles.length === 0) {
        return res.status(502).json({ error: "The AI did not return any usable angles. Please try again." });
      }
      // Sign each angle bound to this tenant + prompt so the drafting
      // endpoint can verify it comes back unmodified.
      const scope = { prompt, tenantDomain: ctx.tenantDomain, secret: angleSecret() };
      res.json({
        angles: angles.map((a) => ({ ...a, token: signQuickAngle(a, scope) })),
        model,
      });
    } catch (err: any) {
      console.error("[quick-generate angles]", err);
      res.status(500).json({ error: err.message || "Failed to generate angles" });
    }
  });

  app.post("/api/quick-generate", async (req, res) => {
    try {
      if (!(await guardFeature(req, res, "campaigns"))) return;

      const prompt = readPrompt(req.body);
      if (!prompt) {
        return res.status(400).json({
          error: `Provide a prompt between ${MIN_PROMPT_LENGTH} and ${MAX_PROMPT_LENGTH} characters.`,
        });
      }

      const deliverables = coerceDeliverables(req.body?.deliverables);
      if (deliverables.length === 0) {
        return res.status(400).json({ error: "Pick at least one deliverable: social, blog, or newsletter." });
      }

      // Per-deliverable feature gates + manual AI action limits, matching the
      // guards on the existing standalone generation routes.
      for (const d of deliverables) {
        if (!(await guardFeature(req, res, DELIVERABLE_FEATURE[d]))) return;
      }
      if (deliverables.includes("social") && !(await guardManualAction(req, res, "aiPostGen"))) return;
      if (deliverables.includes("newsletter") && !(await guardManualAction(req, res, "aiEmailGen"))) return;

      const ctx = await getRequestContext(req);

      const platformsRaw = Array.isArray(req.body?.platforms) ? req.body.platforms : [];
      const platforms: RepurposePlatform[] = platformsRaw
        .map(coercePlatform)
        .filter((p: RepurposePlatform, i: number, a: RepurposePlatform[]) => a.indexOf(p) === i);
      if (deliverables.includes("social") && platforms.length === 0) platforms.push("linkedin");

      const countRaw = Number(req.body?.socialCount);
      const socialCount = Math.min(Math.max(Number.isFinite(countRaw) ? Math.floor(countRaw) : 3, 1), 6);

      // The selected angle round-trips through the client, so it is only
      // accepted with a valid server-issued token binding it to this tenant
      // and this exact prompt. Without this check, a hand-edited angle would
      // be a fact-injection path into prompts that promise prompt-grounding.
      let angle: QuickAngle | null = null;
      if (req.body?.angle) {
        angle = normalizeQuickAngle(req.body.angle);
        const valid =
          angle !== null &&
          verifyQuickAngleToken(angle, req.body.angle.token, {
            prompt,
            tenantDomain: ctx.tenantDomain,
            secret: angleSecret(),
          });
        if (!valid) {
          return res.status(400).json({
            error: "Angle not recognized. Request angles again for this prompt and pick one of them.",
          });
        }
      }

      // Verify a supplied campaign belongs to this tenant + market up front.
      const existingCampaignId =
        typeof req.body?.campaignId === "string" && req.body.campaignId.trim()
          ? req.body.campaignId.trim()
          : null;
      let existingCampaign: typeof campaigns.$inferSelect | null = null;
      if (existingCampaignId) {
        const [row] = await db
          .select()
          .from(campaigns)
          .where(
            and(
              eq(campaigns.id, existingCampaignId),
              eq(campaigns.tenantDomain, ctx.tenantDomain),
              eq(campaigns.marketId, ctx.marketId),
            ),
          );
        if (!row) return res.status(404).json({ error: "Campaign not found" });
        existingCampaign = row;
      }

      const genCtx = {
        tenantDomain: ctx.tenantDomain,
        marketId: ctx.marketId,
        isDefaultMarket: ctx.isDefaultMarket,
        prompt,
        angle,
      };

      // Phase 1 — generate every requested deliverable. One failing never
      // sinks the others; per-deliverable errors are reported back.
      // Note: the personal outbound voice profile is intentionally NOT loaded
      // here — it is user-editable free text that can carry facts, which must
      // never reach prompt-grounded generation.
      const tasks: Partial<Record<QuickDeliverable, Promise<any>>> = {};
      if (deliverables.includes("social")) {
        tasks.social = quickDraftSocialPosts({ ...genCtx, platforms, count: socialCount });
      }
      if (deliverables.includes("blog")) {
        tasks.blog = quickDraftBlog(genCtx);
      }
      if (deliverables.includes("newsletter")) {
        tasks.newsletter = quickDraftNewsletter(genCtx);
      }

      const order = Object.keys(tasks) as QuickDeliverable[];
      const settled = await Promise.allSettled(order.map((k) => tasks[k]!));
      const generated: Partial<Record<QuickDeliverable, any>> = {};
      const failures: Partial<Record<QuickDeliverable, string>> = {};
      settled.forEach((r, i) => {
        if (r.status === "fulfilled") generated[order[i]] = r.value;
        else failures[order[i]] = r.reason instanceof Error ? r.reason.message : String(r.reason);
      });

      if (Object.keys(generated).length === 0) {
        return res.status(502).json({
          error: "Generation failed for every requested deliverable.",
          results: Object.fromEntries(
            order.map((k) => [k, { ok: false, error: failures[k] ?? "Unknown error" }]),
          ),
        });
      }

      // Phase 2 — persist the successes, all linked to one campaign.
      const created = await db.transaction(async (tx) => {
        let campaign = existingCampaign;
        let campaignCreated = false;
        if (!campaign) {
          const [row] = await tx
            .insert(campaigns)
            .values({
              id: randomUUID(),
              tenantDomain: ctx.tenantDomain,
              marketId: ctx.marketId || null,
              name: deriveCampaignNameFromPrompt(prompt),
              campaignType: "theme",
              status: "draft",
              // The raw prompt stays attached as ground truth: objective in
              // the user's words, thematicBrief as the full source text, and
              // briefOnlyMode so later post generation stays prompt-grounded.
              objective: prompt,
              thematicBrief: prompt,
              briefOnlyMode: true,
              createdBy: ctx.userId,
            })
            .returning();
          campaign = row;
          campaignCreated = true;
        }

        const results: Record<string, any> = {};

        if (generated.social) {
          const variantGroup = randomUUID();
          const rows = await tx
            .insert(generatedPosts)
            .values(
              generated.social.posts.map((p: any) => ({
                id: randomUUID(),
                campaignId: campaign!.id,
                tenantDomain: ctx.tenantDomain,
                platform: p.platform,
                content: p.content,
                imagePrompt: p.imagePrompt ?? null,
                variantGroup,
                status: "draft",
                // Undated draft unless the prompt explicitly stated a date.
                scheduledDate: p.scheduledDate ?? undefined,
              })),
            )
            .returning();
          results.social = {
            ok: true,
            postIds: rows.map((r) => r.id),
            platforms: rows.map((r) => r.platform),
          };
        }

        let calendarId: string | null = null;
        if (generated.blog) {
          const draft = generated.blog;
          // Find-or-create the campaign's content-plan calendar (same model
          // as the interview flow) so the brief lands in Content Briefs.
          let [calendar] = await tx
            .select()
            .from(editorialCalendars)
            .where(
              and(
                eq(editorialCalendars.campaignId, campaign!.id),
                eq(editorialCalendars.tenantDomain, ctx.tenantDomain),
              ),
            )
            .limit(1);
          if (!calendar) {
            [calendar] = await tx
              .insert(editorialCalendars)
              .values({
                id: randomUUID(),
                tenantDomain: ctx.tenantDomain,
                marketId: ctx.marketId || null,
                name: `${campaign!.name} — Content Plan`,
                description: campaign!.objective || null,
                campaignId: campaign!.id,
                periodStart: campaign!.startDate ?? null,
                periodEnd: campaign!.endDate ?? null,
                funnelTargets: DEFAULT_FUNNEL_TARGETS,
                focus: campaign!.objective || null,
                status: "active",
                createdBy: ctx.userId,
              })
              .returning();
          }
          calendarId = calendar.id;

          const title = draft.title || deriveCampaignNameFromPrompt(prompt);
          const [brief] = await tx
            .insert(contentBriefs)
            .values({
              id: randomUUID(),
              calendarId: calendar.id,
              tenantDomain: ctx.tenantDomain,
              marketId: ctx.marketId || null,
              campaignId: campaign!.id,
              title,
              format: "blog_post",
              summary: draft.overview || draft.meta || null,
              status: "drafted",
              aiGenerated: true,
              funnelStage: "awareness",
            })
            .returning();

          const [asset] = await tx
            .insert(contentAssets)
            .values({
              id: randomUUID(),
              tenantDomain: ctx.tenantDomain,
              marketId: ctx.marketId || null,
              title,
              description: draft.meta || null,
              content: draft.body,
              subtitle: draft.subtitle || null,
              overview: draft.overview || null,
              // postTags is a text column; draft.tags may be a string[] at
              // runtime. Preserve the existing runtime value and cast so the
              // insert typechecks (same as the brief-draft route).
              postTags: (draft.tags as any) || null,
              assetType: "blog_post",
              status: "active",
              sourceBriefId: brief.id,
              createdBy: ctx.userId,
            })
            .returning();

          await tx
            .update(contentBriefs)
            .set({ contentAssetId: asset.id, updatedAt: new Date() })
            .where(eq(contentBriefs.id, brief.id));

          results.blog = { ok: true, briefId: brief.id, assetId: asset.id, calendarId: calendar.id, title };
        }

        if (generated.newsletter) {
          const nl = generated.newsletter;
          // Presentation is deliberately assembled after generation, rather
          // than passed to the AI: tenant colors and fonts are style only, and
          // the newsletter's facts remain solely those in the user's prompt.
          const [tenant] = await tx
            .select({
              primaryColor: tenants.primaryColor,
              secondaryColor: tenants.secondaryColor,
            })
            .from(tenants)
            .where(eq(tenants.domain, ctx.tenantDomain))
            .limit(1);
          const [bodyFont] = await tx
            .select({ fontFamily: tenantFonts.fontFamily })
            .from(tenantFonts)
            .where(
              and(
                eq(tenantFonts.tenantDomain, ctx.tenantDomain),
                eq(tenantFonts.fontUsage, "body"),
              ),
            )
            .orderBy(tenantFonts.sortOrder)
            .limit(1);
          const configuredFont = bodyFont?.fontFamily ?? null;
          const fontFamily = configuredFont
            ? CURATED_EMAIL_FONTS.find(
                (font) => font.label.toLowerCase() === configuredFont.toLowerCase(),
              )?.value ?? configuredFont
            : null;
          const htmlBody = normalizeFontFamily(
            enforceMinimumFontSize(
              renderQuickNewsletterHtml({
                subject: nl.subject,
                body: nl.body,
                primaryColor: tenant?.primaryColor,
                secondaryColor: tenant?.secondaryColor,
              }),
            ),
            buildFontStack(fontFamily),
          );
          const [email] = await tx
            .insert(generatedEmails)
            .values({
              id: randomUUID(),
              tenantDomain: ctx.tenantDomain,
              marketId: ctx.marketId || null,
              campaignId: campaign!.id,
              // The editor keys its visual HTML mode and responsive export
              // controls off this platform value.
              platform: "hubspot-marketing",
              tone: "professional",
              subject: nl.subject,
              previewText: null,
              htmlBody,
              textBody: nl.body,
              subjectLineSuggestions: nl.subjectSuggestions?.length ? nl.subjectSuggestions : null,
              fontFamily,
              status: "draft",
              createdBy: ctx.userId,
            })
            .returning();
          results.newsletter = { ok: true, emailId: email.id, subject: email.subject };
        }

        return { campaign: campaign!, campaignCreated, calendarId, results };
      });

      // Merge generation failures into the per-deliverable results so the
      // client can show a clear error next to what did succeed.
      for (const d of order) {
        if (failures[d]) created.results[d] = { ok: false, error: failures[d] };
      }

      res.status(201).json({
        campaign: {
          id: created.campaign.id,
          name: created.campaign.name,
          created: created.campaignCreated,
        },
        results: created.results,
      });
    } catch (err: any) {
      console.error("[quick-generate]", err);
      res.status(500).json({ error: err.message || "Quick Generate failed" });
    }
  });
}
