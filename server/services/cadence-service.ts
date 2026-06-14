/**
 * Cadence service.
 *
 * The side-effecting layer over `cadence-core`: enforces the circuit breakers by
 * counting the durable send ledger, advances prospects whose next step is due,
 * auto-pauses campaigns under the reply-rate floor, and rolls up the Active
 * Outreach summary for the Sales home widget. Pure math lives in cadence-core.
 */

import { db } from "../db";
import {
  outreachSettings,
  outreachSendLedger,
  outreachCampaigns,
  prospects,
  outreachTouches,
  cadenceSteps,
  type OutreachChannel,
} from "@shared/schema";
import { and, eq, gte, inArray, ne, sql } from "drizzle-orm";
import { getValidGraphToken } from "./planner-graph-client";
import {
  checkCaps,
  nextDueStep,
  isExhausted,
  belowReplyFloor,
  advanceProspectState,
  type CapSettings,
  type CapDecision,
  type CadenceStepLike,
} from "./cadence-core";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

// Mirror the schema column defaults so a tenant with no saved settings still
// gets conservative, enforced caps.
const DEFAULT_CAPS: CapSettings = {
  globalPause: false,
  masterDailyCap: 100,
  emailDailyCap: 50,
  emailWeeklyCap: 200,
  linkedinDailyCap: 15,
  linkedinWeeklyCap: 50,
  weeklyPerDomainCap: 3,
};

async function loadCaps(tenantDomain: string): Promise<CapSettings> {
  const [row] = await db.select().from(outreachSettings).where(eq(outreachSettings.tenantDomain, tenantDomain));
  if (!row) return DEFAULT_CAPS;
  return {
    globalPause: row.globalPause,
    masterDailyCap: row.masterDailyCap,
    emailDailyCap: row.emailDailyCap,
    emailWeeklyCap: row.emailWeeklyCap,
    linkedinDailyCap: row.linkedinDailyCap,
    linkedinWeeklyCap: row.linkedinWeeklyCap,
    weeklyPerDomainCap: row.weeklyPerDomainCap,
  };
}

function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}
function sevenDaysAgo(now: Date): Date {
  return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
}

async function countLedger(where: any): Promise<number> {
  const [r] = await db.select({ c: sql<number>`count(*)::int` }).from(outreachSendLedger).where(where);
  return r?.c ?? 0;
}

/**
 * Is an approval/send allowed right now? Counts the durable ledger for the
 * master, per-channel, and per-domain windows and applies the breakers.
 */
export async function assertApprovalAllowed(
  tenantDomain: string,
  channel: OutreachChannel,
  recipientDomain: string | null,
): Promise<CapDecision> {
  const caps = await loadCaps(tenantDomain);
  const now = new Date();
  const dayStart = startOfUtcDay(now);
  const weekStart = sevenDaysAgo(now);

  const [masterToday, channelToday, channelWeek, domainWeek] = await Promise.all([
    countLedger(and(eq(outreachSendLedger.tenantDomain, tenantDomain), gte(outreachSendLedger.occurredAt, dayStart))),
    countLedger(and(eq(outreachSendLedger.tenantDomain, tenantDomain), eq(outreachSendLedger.channel, channel), gte(outreachSendLedger.occurredAt, dayStart))),
    countLedger(and(eq(outreachSendLedger.tenantDomain, tenantDomain), eq(outreachSendLedger.channel, channel), gte(outreachSendLedger.occurredAt, weekStart))),
    recipientDomain
      ? countLedger(and(eq(outreachSendLedger.tenantDomain, tenantDomain), eq(outreachSendLedger.recipientDomain, recipientDomain), gte(outreachSendLedger.occurredAt, weekStart)))
      : Promise.resolve(0),
  ]);

  return checkCaps(channel, caps, { masterToday, channelToday, channelWeek, domainWeek });
}

// ── Active Outreach summary (Sales home widget) ──────────────────────────────

export interface OutreachSummary {
  activeCampaigns: number;
  daysRunning: number | null;
  contactsDeveloped: number;
  inCommunication: number;
  replied: number;
  approvedOrSent: number;
  successRate: number; // 0–1
}

const PAST_NEW: string[] = ["researched", "draft_pending_approval", "sent", "awaiting_reply", "replied", "cadence_step_due"];
const IN_COMMS: string[] = ["sent", "awaiting_reply", "replied", "cadence_step_due"];

async function countProspects(tenantDomain: string, statuses: string[]): Promise<number> {
  const [r] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(prospects)
    .where(and(eq(prospects.tenantDomain, tenantDomain), inArray(prospects.status, statuses)));
  return r?.c ?? 0;
}

async function countProspectsInCampaign(campaignId: string, statuses: string[]): Promise<number> {
  const [r] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(prospects)
    .where(and(eq(prospects.campaignId, campaignId), inArray(prospects.status, statuses)));
  return r?.c ?? 0;
}

export async function getOutreachSummary(tenantDomain: string): Promise<OutreachSummary> {
  const liveCampaigns = await db
    .select({ id: outreachCampaigns.id, createdAt: outreachCampaigns.createdAt })
    .from(outreachCampaigns)
    .where(and(eq(outreachCampaigns.tenantDomain, tenantDomain), ne(outreachCampaigns.status, "archived"), ne(outreachCampaigns.status, "completed")));

  let daysRunning: number | null = null;
  if (liveCampaigns.length > 0) {
    const earliest = Math.min(...liveCampaigns.map((c) => new Date(c.createdAt).getTime()));
    daysRunning = Math.max(0, Math.floor((Date.now() - earliest) / (24 * 60 * 60 * 1000)));
  }

  const [contactsDeveloped, inCommunication, replied, approvedOrSentRow] = await Promise.all([
    countProspects(tenantDomain, PAST_NEW),
    countProspects(tenantDomain, IN_COMMS),
    countProspects(tenantDomain, ["replied"]),
    db
      .select({ c: sql<number>`count(*)::int` })
      .from(outreachTouches)
      .where(and(eq(outreachTouches.tenantDomain, tenantDomain), inArray(outreachTouches.status, ["approved", "sent"]))),
  ]);

  const approvedOrSent = approvedOrSentRow[0]?.c ?? 0;
  const successRate = inCommunication > 0 ? replied / inCommunication : 0;

  return {
    activeCampaigns: liveCampaigns.length,
    daysRunning,
    contactsDeveloped,
    inCommunication,
    replied,
    approvedOrSent,
    successRate,
  };
}

// ── Cadence tick (DB-driven step advancement + reply-floor auto-pause) ───────

export interface TickResult {
  prospectsAdvanced: number;
  prospectsExhausted: number;
  campaignsPaused: number;
}

/** Anchor date for a campaign's cadence: the event date, else campaign start. */
function anchorFor(campaign: { eventDate: Date | null; createdAt: Date }): Date {
  return campaign.eventDate ? new Date(campaign.eventDate) : new Date(campaign.createdAt);
}

/**
 * Advance prospects whose next cadence step is due (→ cadence_step_due) or whose
 * sequence is exhausted (→ dormant), and auto-pause campaigns below the reply
 * floor. DB-driven and deterministic; Graph-based send/reply auto-detection is a
 * separate live-integration step.
 */
export async function tickCadence(tenantDomain: string): Promise<TickResult> {
  const now = new Date();
  const caps = await loadCaps(tenantDomain);
  const result: TickResult = { prospectsAdvanced: 0, prospectsExhausted: 0, campaignsPaused: 0 };

  // Global kill switch: when paused, don't advance prospects toward new sends.
  if (caps.globalPause) return result;

  const campaigns = await db
    .select()
    .from(outreachCampaigns)
    .where(and(eq(outreachCampaigns.tenantDomain, tenantDomain), eq(outreachCampaigns.status, "active")));

  // Reply-rate floor is tenant-configured but applied per campaign.
  const [settingsRow] = await db.select().from(outreachSettings).where(eq(outreachSettings.tenantDomain, tenantDomain));
  const floor = settingsRow?.minReplyRateFloor ?? 0;

  for (const campaign of campaigns) {
    const steps: CadenceStepLike[] = campaign.cadenceTemplateId
      ? (await db.select().from(cadenceSteps).where(eq(cadenceSteps.templateId, campaign.cadenceTemplateId))).map((s) => ({
          stepNumber: s.stepNumber,
          dayOffset: s.dayOffset,
          businessHoursOnly: s.businessHoursOnly,
          channel: s.channel as OutreachChannel,
        }))
      : [];

    const awaiting = await db
      .select()
      .from(prospects)
      .where(and(eq(prospects.campaignId, campaign.id), eq(prospects.status, "awaiting_reply")));

    const anchor = anchorFor(campaign);

    // Batch-load every awaiting prospect's touches in one query (avoid N+1).
    const awaitingIds = awaiting.map((p) => p.id);
    const touchRows = awaitingIds.length
      ? await db
          .select({ prospectId: outreachTouches.prospectId, stepNumber: outreachTouches.stepNumber })
          .from(outreachTouches)
          .where(inArray(outreachTouches.prospectId, awaitingIds))
      : [];
    const completedByProspect = new Map<string, number[]>();
    for (const t of touchRows) {
      const arr = completedByProspect.get(t.prospectId) ?? [];
      arr.push(t.stepNumber);
      completedByProspect.set(t.prospectId, arr);
    }

    for (const p of awaiting) {
      const completed = completedByProspect.get(p.id) ?? [];

      if (isExhausted(steps, completed)) {
        await db.update(prospects).set({ status: "dormant", nextActionAt: null, updatedAt: now }).where(eq(prospects.id, p.id));
        result.prospectsExhausted++;
        continue;
      }
      const due = nextDueStep(steps, completed, anchor, now);
      if (due) {
        await db.update(prospects).set({ status: "cadence_step_due", nextActionAt: now, updatedAt: now }).where(eq(prospects.id, p.id));
        result.prospectsAdvanced++;
      }
    }

    // Reply-rate floor → auto-pause THIS campaign (scoped to the campaign, not
    // the whole tenant, so one campaign's performance can't pause another).
    if (floor > 0) {
      const sent = await countProspectsInCampaign(campaign.id, IN_COMMS);
      const replied = await countProspectsInCampaign(campaign.id, ["replied"]);
      if (belowReplyFloor(replied, sent, floor)) {
        await db.update(outreachCampaigns).set({ status: "paused", updatedAt: now }).where(eq(outreachCampaigns.id, campaign.id));
        result.campaignsPaused++;
      }
    }
  }

  return result;
}

// ── Graph-based send / reply auto-detection (best-effort) ────────────────────

export interface MailboxActivityResult {
  touchesConfirmedSent: number;
  repliesDetected: number;
}

async function graphGet(token: string, path: string): Promise<{ status: number; json: any }> {
  const res = await fetch(`${GRAPH_BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const json = res.ok ? await res.json().catch(() => null) : null;
  return { status: res.status, json };
}

/**
 * Read the seller's mailbox to advance the lifecycle automatically:
 *  - confirm approved email touches were actually SENT (draft left Drafts),
 *  - detect inbound REPLIES from prospects → advance to `replied`.
 * Best-effort and gated on the delegated token; degrades silently without it.
 */
export async function detectMailboxActivity(userId: string, tenantDomain: string): Promise<MailboxActivityResult> {
  const result: MailboxActivityResult = { touchesConfirmedSent: 0, repliesDetected: 0 };
  const token = await getValidGraphToken(userId);
  if (!token) return result;

  const owned = await db
    .select()
    .from(prospects)
    .where(and(eq(prospects.tenantDomain, tenantDomain), eq(prospects.ownerUserId, userId)));
  if (owned.length === 0) return result;
  const ownedIds = new Set(owned.map((p) => p.id));

  // 1) Confirm sends: approved email touches whose draft has left the Drafts
  //    folder (isDraft=false, or 404 because the id changed on send).
  const approved = await db
    .select()
    .from(outreachTouches)
    .where(and(eq(outreachTouches.tenantDomain, tenantDomain), eq(outreachTouches.status, "approved"), eq(outreachTouches.channel, "email")));
  for (const t of approved) {
    if (!t.outlookDraftId || !ownedIds.has(t.prospectId)) continue;
    try {
      const { status, json } = await graphGet(token, `/me/messages/${t.outlookDraftId}?$select=isDraft`);
      const wasSent = status === 404 || (status === 200 && json?.isDraft === false);
      if (wasSent) {
        await db.update(outreachTouches).set({ status: "sent", sentAt: new Date() }).where(eq(outreachTouches.id, t.id));
        result.touchesConfirmedSent++;
      }
    } catch { /* best-effort */ }
  }

  // 2) Detect replies for prospects awaiting a response.
  for (const p of owned) {
    if (p.status !== "awaiting_reply" && p.status !== "cadence_step_due") continue;
    if (!p.email) continue;
    try {
      // OData: escape single quotes by doubling, keep the value un-percent-encoded
      // inside the quotes, and encode the whole $filter (so spaces become %20).
      const filter = `from/emailAddress/address eq '${p.email.replace(/'/g, "''")}'`;
      const { json } = await graphGet(
        token,
        `/me/messages?$filter=${encodeURIComponent(filter)}&$top=1&$orderby=receivedDateTime%20desc&$select=receivedDateTime`,
      );
      const latest = json?.value?.[0]?.receivedDateTime;
      if (!latest) continue;
      // Only count replies arriving after our most recent touch actually went
      // out (sentAt), falling back to draft creation time when not yet stamped.
      const touches = await db
        .select({ sentAt: outreachTouches.sentAt, generatedAt: outreachTouches.generatedAt })
        .from(outreachTouches)
        .where(eq(outreachTouches.prospectId, p.id));
      const lastTouchAt = touches.reduce(
        (m, t) => Math.max(m, new Date(t.sentAt ?? t.generatedAt).getTime()),
        0,
      );
      if (new Date(latest).getTime() > lastTouchAt) {
        const next = advanceProspectState(p.status as any, "reply_detected");
        if (next) {
          await db.update(prospects).set({ status: next, nextActionAt: null, updatedAt: new Date() }).where(eq(prospects.id, p.id));
          result.repliesDetected++;
        }
      }
    } catch { /* best-effort */ }
  }

  return result;
}

/**
 * One tenant's full cadence pass: advance due steps + reply-floor, then read the
 * mailbox of each seller with open prospects to auto-detect sends/replies. Used
 * by the scheduled sweep.
 */
export async function runCadenceForTenant(tenantDomain: string): Promise<TickResult & MailboxActivityResult> {
  const tick = await tickCadence(tenantDomain);
  const owners = await db
    .selectDistinct({ ownerUserId: prospects.ownerUserId })
    .from(prospects)
    .where(and(eq(prospects.tenantDomain, tenantDomain), inArray(prospects.status, ["awaiting_reply", "cadence_step_due"])));

  let touchesConfirmedSent = 0;
  let repliesDetected = 0;
  for (const { ownerUserId } of owners) {
    if (!ownerUserId) continue;
    const r = await detectMailboxActivity(ownerUserId, tenantDomain);
    touchesConfirmedSent += r.touchesConfirmedSent;
    repliesDetected += r.repliesDetected;
  }
  return { ...tick, touchesConfirmedSent, repliesDetected };
}
