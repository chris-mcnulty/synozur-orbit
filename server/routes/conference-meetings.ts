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
import { OutreachContextError } from "../services/outreach-context-service";
import { ensureContactForPerson, addCampaignMembership } from "../services/prospect-contact-service";
import { isValidLinkedInProfileUrl } from "@shared/linkedin-outreach";
import { randomBytes } from "crypto";
import { storage } from "../storage";
import { getRedirectUri } from "./planner";
import { buildPlannerConsentUrl, CALENDAR_SCOPES } from "../services/planner-graph-client";
import { calendarConnection, previewCalendarInvitation, getCalendarInvitation, sendCalendarInvitation, cancelCalendarInvitation } from "../services/conference-calendar-service";
import { calendarInvitationSchema } from "@shared/conference-meetings";
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
        if (error instanceof OutreachContextError) return res.status(error.status).json({ error: error.message, code: error.code });
        if (error instanceof MeetingError || error instanceof ContextError) return res.status(error.status).json({ error: error.message });
        console.error("[conference-meetings] Request failed", error instanceof Error ? error.name : "Unknown");
        res.status(500).json({ error: "The meeting operation could not be confirmed. For calendar delivery, check the invitation status before retrying; nothing will be resent automatically." });
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
  app.get(`${personBase}/calendar`, route(async (req, res, ctx) => {
    await getMeetingPerson(ctx.tenantDomain, req.params.id, ctx.marketId);
    res.json({
      ...await calendarConnection(ctx.userId),
      invitation: await getCalendarInvitation(ctx.tenantDomain, req.params.id),
      userId: ctx.userId,
    });
  }));
  app.get(`${personBase}/calendar/consent-url`, route(async (req, res, ctx) => {
    await getMeetingPerson(ctx.tenantDomain, req.params.id, ctx.marketId);
    const user = await storage.getUser(ctx.userId);
    const scopes = Array.from(new Set([...(user?.graphScopes || "").split(/\s+/).filter(Boolean), ...CALENDAR_SCOPES]));
    const state = Buffer.from(JSON.stringify({
      userId: ctx.userId, returnTo: req.query.returnTo || "/app/sales/outreach",
      nonce: randomBytes(16).toString("hex"),
    })).toString("base64url");
    const url = buildPlannerConsentUrl({ state, redirectUri: getRedirectUri(req), scopes });
    if (!url) throw new MeetingError("Microsoft Entra is not configured.", 503);
    res.json({ url });
  }, true));
  app.post(`${personBase}/calendar/preview`, route(async (req, res, ctx) => {
    res.json(await previewCalendarInvitation(ctx.tenantDomain, req.params.id, ctx.marketId, ctx.userId, req.body));
  }, true));
  app.post(`${personBase}/calendar/send`, route(async (req, res, ctx) => {
    const data = z.object({ invitation: calendarInvitationSchema, fingerprint: z.string().length(64), confirmed: z.literal(true) }).strict().parse(req.body);
    await getMeetingPerson(ctx.tenantDomain, req.params.id, ctx.marketId);
    res.json(await sendCalendarInvitation(ctx.tenantDomain, req.params.id, ctx.marketId, ctx.userId, data.invitation, data.fingerprint));
  }, true));
  app.post(`${personBase}/calendar/cancel`, route(async (req, res, ctx) => {
    const data = z.object({ confirmed: z.literal(true), fingerprint: z.string().length(64) }).strict().parse(req.body);
    await getMeetingPerson(ctx.tenantDomain, req.params.id, ctx.marketId);
    res.json(await cancelCalendarInvitation(ctx.tenantDomain, req.params.id, ctx.userId, data.fingerprint));
  }, true));
  app.patch(personBase, route(async (req, res, ctx) => {
    const edit = meetingContactEditSchema.parse(req.body);
    const { person } = await getMeetingPerson(ctx.tenantDomain, req.params.id, ctx.marketId);
    if (edit.selectedAngleId && !person.meeting.angles?.some(a => a.id === edit.selectedAngleId)) throw new MeetingError("Select an existing proposed angle.", 422);
    if (edit.stage === "meeting_booked" && (!edit.meetingAt || !edit.meetingOwner.trim())) throw new MeetingError("A booked meeting needs a time and owner.", 422);
    const meeting = { ...person.meeting, ...edit };
    await saveMeeting(ctx.tenantDomain, req.params.id, meeting, person.meeting);
    res.json(meeting);
  }, true));
  app.post(`${personBase}/review`, route(async (req, res, ctx) => {
    const { workspace, person } = await getMeetingPerson(ctx.tenantDomain, req.params.id, ctx.marketId);
    const review = await reviewConferenceRelationship(ctx.tenantDomain, req.params.id, workspace.brief?.lookbackDays ?? 90);
    // Refreshing the review intentionally invalidates old angle evidence.
    await saveMeeting(ctx.tenantDomain, req.params.id, { ...person.meeting, review }, person.meeting);
    res.json(review);
  }, true));
  app.post(`${personBase}/angles`, route(async (req, res, ctx) => {
    const { workspace, person } = await getMeetingPerson(ctx.tenantDomain, req.params.id, ctx.marketId);
    if (!workspace.brief?.enabled) throw new MeetingError("Enable and save the meeting brief first.", 422);
    if (["do_not_contact", "declined", "unavailable"].includes(person.meeting.stage) || person.meeting.attendance === "not_attending") {
      throw new MeetingError("This contact is excluded from event outreach. Review and save their attendance and meeting stage before generating angles.", 422);
    }
    let review;
    try {
      review = await reviewConferenceRelationship(ctx.tenantDomain, req.params.id, workspace.brief.lookbackDays ?? 90, { requireAvailableSources: true });
    } catch {
      throw new MeetingError("Relationship history could not be checked. Retry Generate 3 angles. If the problem continues, check the HubSpot connection and CRM activity permissions or ask an administrator to check Orbit history access. No angles were generated.", 503);
    }
    if (review.suppressed) throw new MeetingError("This contact is suppressed or opted out. Angles cannot be generated.", 422);
    const meeting = { ...person.meeting, review };
    const angles = proposeMeetingAngles(workspace.conference.name, meeting, review, workspace.sessions, {
      goals: workspace.effectiveBrief?.goals ?? workspace.brief.goals,
      brief: [workspace.sourceContext?.eventBrief, workspace.sourceContext?.campaignBrief].filter(Boolean).join("\n\n"),
    });
    const fingerprint = meetingContactFingerprint(workspace.fingerprint, meeting);
    await saveMeeting(ctx.tenantDomain, req.params.id, {
      ...meeting, angles, anglesFingerprint: fingerprint, selectedAngleId: null, selectedHook: "", selectedAsk: "",
    }, person.meeting);
    res.json({ angles, fingerprint, review });
  }, true));
  app.post(`${personBase}/draft`, route(async (req, res, ctx) => {
    const data = z.object({ channel: z.enum(["email", "linkedin"]), additionalContext: z.string().trim().max(6000).optional(), contextFingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict().parse(req.body);
    const { workspace } = await getMeetingPerson(ctx.tenantDomain, req.params.id, ctx.marketId);
    if (!workspace.brief?.enabled) throw new MeetingError("Enable and save the meeting brief first.", 422);
    if (!(await guardFeature(req, res, "outreachComposer")) || !(await guardManualAction(req, res, "generateOutreachDraft"))) return;
    const result = await composeTouch(ctx.tenantDomain, req.params.id, {
      channel: data.channel, additionalContext: data.additionalContext, contextFingerprint: data.contextFingerprint, intent: "outreach", isDefaultMarket: ctx.isDefaultMarket,
    });
    await logAiUsage({ tenantDomain: ctx.tenantDomain, marketId: ctx.marketId, userId: ctx.userId },
      "generateOutreachDraft", result.provider, result.model,
      { input_tokens: result.usage.inputTokens, output_tokens: result.usage.outputTokens });
    res.status(201).json(result);
  }, true));
}
