/**
 * Cadence — pure core.
 *
 * The deterministic heart of the sequencing engine: the prospect state machine,
 * timing-window math (incl. event-anchored back-dating + business-day shifting),
 * due-step computation, and the master circuit-breaker / cap checks. No I/O, so
 * it is unit-testable; the Graph reply-detection + DB writes live in
 * `cadence-service.ts`.
 */

import type { ProspectStatus, OutreachChannel } from "@shared/schema";

// ── State machine ────────────────────────────────────────────────────────────

export type CadenceEvent = "sent_detected" | "reply_detected" | "step_due" | "exhausted" | "disqualified";

const TRANSITIONS: Partial<Record<ProspectStatus, Partial<Record<CadenceEvent, ProspectStatus>>>> = {
  draft_pending_approval: { sent_detected: "sent", disqualified: "dormant" },
  sent: { sent_detected: "awaiting_reply", reply_detected: "replied", disqualified: "dormant" },
  awaiting_reply: { reply_detected: "replied", step_due: "cadence_step_due", exhausted: "dormant", disqualified: "dormant" },
  cadence_step_due: { reply_detected: "replied", disqualified: "dormant" },
  replied: { disqualified: "dormant" },
};

/** Next prospect state for an event, or null when the event doesn't apply. */
export function advanceProspectState(current: ProspectStatus, event: CadenceEvent): ProspectStatus | null {
  return TRANSITIONS[current]?.[event] ?? null;
}

// ── Timing ───────────────────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

/** Shift a date off the weekend onto the next business day (Mon). */
export function toBusinessDay(date: Date): Date {
  const day = date.getUTCDay(); // 0 = Sun, 6 = Sat
  if (day === 6) return addDays(date, 2);
  if (day === 0) return addDays(date, 1);
  return date;
}

/**
 * The scheduled date for a step: anchor + dayOffset (offset may be negative for
 * event-anchored back-dated steps), optionally shifted to a business day.
 */
export function stepDate(anchorDate: Date, dayOffset: number, businessHoursOnly: boolean): Date {
  const base = addDays(anchorDate, dayOffset);
  return businessHoursOnly ? toBusinessDay(base) : base;
}

export interface CadenceStepLike {
  stepNumber: number;
  dayOffset: number;
  businessHoursOnly: boolean;
  channel: OutreachChannel;
}

/**
 * The next step that is due: the lowest-numbered not-yet-completed step whose
 * scheduled date is at or before `now`. Returns null when nothing is due.
 */
export function nextDueStep(
  steps: CadenceStepLike[],
  completedStepNumbers: number[],
  anchorDate: Date,
  now: Date,
): CadenceStepLike | null {
  const done = new Set(completedStepNumbers);
  const pending = steps
    .filter((s) => !done.has(s.stepNumber))
    .sort((a, b) => a.stepNumber - b.stepNumber);
  for (const s of pending) {
    if (stepDate(anchorDate, s.dayOffset, s.businessHoursOnly).getTime() <= now.getTime()) return s;
  }
  return null;
}

/** True when every step is completed (sequence exhausted). */
export function isExhausted(steps: CadenceStepLike[], completedStepNumbers: number[]): boolean {
  const done = new Set(completedStepNumbers);
  return steps.length > 0 && steps.every((s) => done.has(s.stepNumber));
}

// ── Circuit breakers / caps ──────────────────────────────────────────────────

export interface CapSettings {
  globalPause: boolean;
  masterDailyCap: number;
  emailDailyCap: number;
  emailWeeklyCap: number;
  linkedinDailyCap: number;
  linkedinWeeklyCap: number;
  weeklyPerDomainCap: number;
}

export interface CapCounts {
  /** Total approvals today across all channels (master breaker). */
  masterToday: number;
  channelToday: number;
  channelWeek: number;
  /** Touches into the recipient's domain this week (0 if no recipient domain). */
  domainWeek: number;
}

export interface CapDecision {
  allowed: boolean;
  reason?: string;
}

/**
 * Decide whether an approval/send is allowed right now. Fails CLOSED: the global
 * pause and every cap is a hard stop, with the strictest LinkedIn limits applied
 * by channel. Counts come from the durable send ledger.
 */
export function checkCaps(channel: OutreachChannel, caps: CapSettings, counts: CapCounts): CapDecision {
  if (caps.globalPause) return { allowed: false, reason: "Outreach is paused (global circuit breaker)." };

  if (counts.masterToday >= caps.masterDailyCap) {
    return { allowed: false, reason: `Master daily cap reached (${caps.masterDailyCap}/day).` };
  }

  const dailyCap = channel === "linkedin" ? caps.linkedinDailyCap : caps.emailDailyCap;
  const weeklyCap = channel === "linkedin" ? caps.linkedinWeeklyCap : caps.emailWeeklyCap;

  if (counts.channelToday >= dailyCap) {
    return { allowed: false, reason: `${channel} daily cap reached (${dailyCap}/day).` };
  }
  if (counts.channelWeek >= weeklyCap) {
    return { allowed: false, reason: `${channel} weekly cap reached (${weeklyCap}/week).` };
  }
  if (counts.domainWeek >= caps.weeklyPerDomainCap) {
    return { allowed: false, reason: `Per-domain weekly cap reached (${caps.weeklyPerDomainCap}/week into this company).` };
  }
  return { allowed: true };
}

/** Reply-rate floor: true when a campaign should auto-pause. 0 floor = off. */
export function belowReplyFloor(repliedCount: number, sentCount: number, floor: number): boolean {
  if (floor <= 0 || sentCount < 5) return false; // need a minimum sample
  return repliedCount / sentCount < floor;
}
