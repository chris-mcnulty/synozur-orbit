import type { Express, Request, Response } from "express";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { conferences, outreachCampaigns } from "@shared/schema";
import { getRequestContext, ContextError } from "../context";
import { guardFeature, guardManualAction, logAiUsage } from "./helpers";
import {
  eventPresenceSchema, meetingBriefSchema, meetingContactEditSchema, defaultMeetingContact,
} from "@shared/conference-meetings";
import { getConferenceWorkspace, getMeetingPerson, saveMeeting, MeetingError } from "../services/conference-meetings-service";
import { meetingContactFingerprint, proposeMeetingAngles } from "../services/conference-meetings-core";
import { reviewConferenceRelationship } from "../services/conference-relationship-review";
import { composeTouch } from "../services/outreach-composer-service";
import { OutreachComposeError } from "../services/outreach-draft-outcome";
import { ensureContactForPerson, addCampaignMembership } from "../services/prospect-contact-service";
import { isValidLinkedInProfileUrl } from "@shared/linkedin-outreach";
import { recommendConferenceContacts, importConferenceRecommendations } from "../services/conference-warm-contacts";

const externalPerson = z.object({
  name: z.string().trim().max(300).optional(),
  email: z.union([z.literal(""), z.string().trim().email().max(320)]).optional(),
  companyName: z.string().trim().max(400).optional(), title: z.string().trim().max(400).optional(),
  linkedinUrl: z.string().trim().max(2000).optional(),
}).strict().refine(c => !!(c.email || c.linkedinUrl), "An email or LinkedIn URL is required")
  .refine(c => !c.linkedinUrl || isValidLinkedInProfileUrl(c.linkedinUrl), "Use a LinkedIn profile URL");

export function registerConferenceMeetingsRoutes(app: Express) {
  const route = (fn: (req: Request, res: Response, ctx: Awaited<ReturnType<typeof getRequestContext>>) => Promise<unknown>, write = false) =>
    async (req: Request, res: Response) => {
      try {
        if (!(await guardFeature(req, res, "salesOutreachCampaigns"))) return;
        const ctx = await getRequestContext(req);
        if (write && ["Standard User", "Consultant"].includes(ctx.userRole)) return res.status(403).json({ error: "A read-only role cannot change meeting plans." });
        await fn(req, res, ctx);
      } catch (error) {
        if (error instanceof z.ZodError) return res.status(400).json({ error: error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ") });
        if (error instanceof OutreachComposeError) return res.status(422).json({ error: error.message, code: error.code, questions: error.questions });
        if (error instanceof MeetingError || error instanceof ContextError) return res.status(error.status).json({ error: error.message });
        console.error("[conference-meetings] Request failed", error instanceof Error ? error.name : "Unknown");
        res.status(500).json({ error: "The meeting operation failed. Nothing was sent. Please try again." });
      }
    };
  const base = "/api/sales-outreach/campaigns/:id/meetings";
  app.get(base, route(async (req, res, ctx) => {
    res.json(await getConferenceWorkspace(ctx.tenantDomain, req.params.id, ctx.marketId));
  }));
  app.post(`${base}/recommendations`, route(async (req, res, ctx) => {
    z.object({}).strict().parse(req.body);
    res.json(await recommendConferenceContacts(ctx.tenantDomain, req.params.id, ctx.marketId));
  }));
  app.post(`${base}/recommendations/import`, route(async (req, res, ctx) => {
    const data = z.object({ contactIds: z.array(z.string().regex(/^\d+$/).max(100)).min(1).max(10) }).strict().parse(req.body);
    res.status(201).json(await importConferenceRecommendations(ctx.tenantDomain, req.params.id, data.contactIds, ctx.marketId));
  }, true));
  app.patch(base, route(async (req, res, ctx) => {
    const patch = z.object({ brief: meetingBriefSchema, presence: eventPresenceSchema }).strict().parse(req.body);
    const workspace = await getConferenceWorkspace(ctx.tenantDomain, req.params.id, ctx.marketId);
    await db.transaction(async tx => {
      await tx.update(outreachCampaigns).set({ meetingBrief: patch.brief, updatedAt: new Date() })
        .where(and(eq(outreachCampaigns.id, workspace.campaignId), eq(outreachCampaigns.tenantDomain, ctx.tenantDomain)));
      await tx.update(conferences).set({ presence: patch.presence, updatedAt: new Date() })
        .where(and(eq(conferences.id, workspace.conference.id), eq(conferences.tenantDomain, ctx.tenantDomain)));
    });
    res.json(await getConferenceWorkspace(ctx.tenantDomain, req.params.id, ctx.marketId));
  }, true));
  app.post(`${base}/import`, route(async (req, res, ctx) => {
    const data = z.object({
      source: z.enum(["wiza", "salesnav", "manual"]), contacts: z.array(externalPerson).min(1).max(100),
    }).strict().parse(req.body);
    const workspace = await getConferenceWorkspace(ctx.tenantDomain, req.params.id, ctx.marketId);
    let imported = 0;
    for (const c of data.contacts) {
      const person = await ensureContactForPerson(ctx.tenantDomain, { ...c, name: c.name || c.email || "LinkedIn contact" }, data.source);
      const membership = await addCampaignMembership({
        tenantDomain: ctx.tenantDomain, campaignId: workspace.campaignId, marketId: ctx.marketId,
        contactId: person.contactId, source: data.source, meeting: defaultMeetingContact(), status: "new",
      });
      if (membership.created) imported++;
    }
    res.status(201).json({ imported, skipped: data.contacts.length - imported });
  }, true));
  const personBase = "/api/sales-outreach/prospects/:id/meeting";
  app.patch(personBase, route(async (req, res, ctx) => {
    const edit = meetingContactEditSchema.parse(req.body);
    const { person } = await getMeetingPerson(ctx.tenantDomain, req.params.id, ctx.marketId);
    if (edit.selectedAngleId && !person.meeting.angles?.some(a => a.id === edit.selectedAngleId)) throw new MeetingError("Select an existing proposed angle.", 422);
    if (edit.stage === "meeting_booked" && (!edit.meetingAt || !edit.meetingOwner.trim())) throw new MeetingError("A booked meeting needs a time and owner.", 422);
    const meeting = { ...person.meeting, ...edit };
    await saveMeeting(ctx.tenantDomain, req.params.id, meeting);
    res.json(meeting);
  }, true));
  app.post(`${personBase}/review`, route(async (req, res, ctx) => {
    const { workspace, person } = await getMeetingPerson(ctx.tenantDomain, req.params.id, ctx.marketId);
    const review = await reviewConferenceRelationship(ctx.tenantDomain, req.params.id, workspace.brief?.lookbackDays ?? 90);
    // Refreshing the review intentionally invalidates old angle evidence.
    await saveMeeting(ctx.tenantDomain, req.params.id, { ...person.meeting, review });
    res.json(review);
  }, true));
  app.post(`${personBase}/angles`, route(async (req, res, ctx) => {
    const { workspace, person } = await getMeetingPerson(ctx.tenantDomain, req.params.id, ctx.marketId);
    if (!workspace.brief?.enabled) throw new MeetingError("Enable and save the meeting brief first.", 422);
    if (!person.meeting.review) throw new MeetingError("Review the relationship first.", 422);
    if (person.meeting.review.suppressed || person.meeting.stage === "do_not_contact") throw new MeetingError("This contact is suppressed or marked do not contact.", 422);
    const angles = proposeMeetingAngles(workspace.conference.name, person.meeting, person.meeting.review, workspace.sessions);
    const fingerprint = meetingContactFingerprint(workspace.fingerprint, person.meeting);
    await saveMeeting(ctx.tenantDomain, req.params.id, {
      ...person.meeting, angles, anglesFingerprint: fingerprint, selectedAngleId: null, selectedHook: "", selectedAsk: "",
    });
    res.json({ angles, fingerprint });
  }, true));
  app.post(`${personBase}/draft`, route(async (req, res, ctx) => {
    const data = z.object({ channel: z.enum(["email", "linkedin"]), additionalContext: z.string().trim().max(6000).optional() }).strict().parse(req.body);
    const { workspace } = await getMeetingPerson(ctx.tenantDomain, req.params.id, ctx.marketId);
    if (!workspace.brief?.enabled) throw new MeetingError("Enable and save the meeting brief first.", 422);
    if (!(await guardFeature(req, res, "outreachComposer")) || !(await guardManualAction(req, res, "generateOutreachDraft"))) return;
    const result = await composeTouch(ctx.tenantDomain, req.params.id, {
      channel: data.channel, additionalContext: data.additionalContext, intent: "outreach", isDefaultMarket: ctx.isDefaultMarket,
    });
    await logAiUsage({ tenantDomain: ctx.tenantDomain, marketId: ctx.marketId, userId: ctx.userId },
      "generateOutreachDraft", result.provider, result.model,
      { input_tokens: result.usage.inputTokens, output_tokens: result.usage.outputTokens });
    res.status(201).json(result);
  }, true));
}
