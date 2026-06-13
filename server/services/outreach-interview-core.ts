/**
 * Outreach Interview — pure core.
 *
 * The onboarding wizard turns a conversation (goal, message, ICP, geography/
 * industry refinements, offering, CTA, event, resources) into a campaign brief
 * + a targeting filter + a default cadence. This module holds the deterministic
 * logic: the step graph, goal-type classification, cadence-archetype selection,
 * default cadence-step generation, and targeting-filter normalization. No I/O,
 * so it is unit-testable. Persistence + any AI suggestion turns live in
 * `outreach-interview-service.ts`.
 */

import type {
  OutreachGoalType,
  OutreachChannel,
  OutreachTargetingFilter,
  CadenceArchetype,
  CadenceAnchor,
  CadenceStepPurpose,
} from "@shared/schema";

// ── Interview step graph ─────────────────────────────────────────────────────

export interface InterviewStep {
  key: string;
  label: string;
  /** The question shown to the user. */
  prompt: string;
  required: boolean;
}

export const INTERVIEW_STEPS: InterviewStep[] = [
  { key: "goal", label: "Goal", prompt: "What outcome do you want from this campaign?", required: true },
  { key: "message", label: "Message", prompt: "What's the core message or offering?", required: true },
  { key: "icp", label: "Target ICP", prompt: "Who are we targeting (roles, persona)?", required: true },
  { key: "refinements", label: "Refinements", prompt: "Any geography, industry, or company-size focus?", required: false },
  { key: "cta", label: "Call to action", prompt: "What's the specific ask, and how do they act on it?", required: true },
  { key: "event", label: "Event", prompt: "Is this tied to an event? (optional)", required: false },
  { key: "resources", label: "Resources", prompt: "Any assets to include (scheduler, deck, event details)?", required: false },
  { key: "voice", label: "Voice", prompt: "Whose voice should drafts sound like?", required: false },
];

// ── Goal-type classification ─────────────────────────────────────────────────

const GOAL_KEYWORDS: { type: OutreachGoalType; words: string[] }[] = [
  { type: "event_invite", words: ["invite", "rsvp", "dinner", "roundtable", "reception", "webinar", "event", "conference", "booth"] },
  { type: "intro", words: ["introduce", "introduction", "announce", "launch", "awareness", "intro"] },
  { type: "nurture", words: ["nurture", "stay in touch", "follow up", "re-engage", "reengage", "warm"] },
  { type: "meeting", words: ["meeting", "call", "demo", "discovery", "book", "schedule", "intro call"] },
];

/** Classify a free-text goal into a goal type. Defaults to "meeting". */
export function classifyGoalType(goalText: string | null | undefined): OutreachGoalType {
  const g = (goalText ?? "").toLowerCase();
  if (!g.trim()) return "meeting";
  // Event wins over meeting when both appear ("book a meeting at the event").
  for (const { type, words } of GOAL_KEYWORDS) {
    if (words.some((w) => g.includes(w))) return type;
  }
  return "meeting";
}

/** The cadence archetype that fits a goal type. */
export function archetypeForGoal(goalType: OutreachGoalType): CadenceArchetype {
  switch (goalType) {
    case "event_invite":
      return "event_invite";
    case "nurture":
      return "nurture";
    case "meeting":
    case "intro":
    default:
      return "meeting_drive";
  }
}

// ── Default cadence steps per archetype ──────────────────────────────────────

export interface DefaultCadenceStep {
  stepNumber: number;
  channel: OutreachChannel;
  dayOffset: number;
  purpose: CadenceStepPurpose;
  businessHoursOnly: boolean;
}

export interface DefaultCadence {
  archetype: CadenceArchetype;
  anchor: CadenceAnchor;
  steps: DefaultCadenceStep[];
}

/**
 * The default sequence for an archetype. Event-invite steps are anchored to the
 * event and back-dated (negative offsets — N days BEFORE the event).
 */
export function defaultCadence(archetype: CadenceArchetype): DefaultCadence {
  switch (archetype) {
    case "event_invite":
      return {
        archetype,
        anchor: "event_date",
        steps: [
          { stepNumber: 1, channel: "email", dayOffset: -21, purpose: "invite", businessHoursOnly: true },
          { stepNumber: 2, channel: "linkedin", dayOffset: -14, purpose: "value", businessHoursOnly: true },
          { stepNumber: 3, channel: "email", dayOffset: -7, purpose: "invite", businessHoursOnly: true },
          { stepNumber: 4, channel: "email", dayOffset: -2, purpose: "breakup", businessHoursOnly: true },
        ],
      };
    case "nurture":
      return {
        archetype,
        anchor: "start_date",
        steps: [
          { stepNumber: 1, channel: "email", dayOffset: 0, purpose: "value", businessHoursOnly: true },
          { stepNumber: 2, channel: "email", dayOffset: 14, purpose: "case_study", businessHoursOnly: true },
          { stepNumber: 3, channel: "linkedin", dayOffset: 30, purpose: "value", businessHoursOnly: true },
        ],
      };
    case "meeting_drive":
    default:
      return {
        archetype: "meeting_drive",
        anchor: "start_date",
        steps: [
          { stepNumber: 1, channel: "email", dayOffset: 0, purpose: "intro", businessHoursOnly: true },
          { stepNumber: 2, channel: "email", dayOffset: 3, purpose: "value", businessHoursOnly: true },
          { stepNumber: 3, channel: "linkedin", dayOffset: 5, purpose: "value", businessHoursOnly: true },
          { stepNumber: 4, channel: "email", dayOffset: 9, purpose: "breakup", businessHoursOnly: true },
        ],
      };
  }
}

// ── Targeting-filter normalization ───────────────────────────────────────────

function cleanList(xs: unknown): string[] | undefined {
  if (!Array.isArray(xs)) return undefined;
  const out = Array.from(new Set(xs.map((x) => String(x).trim()).filter(Boolean)));
  return out.length > 0 ? out : undefined;
}

/** Normalize raw interview refinement answers into a targeting filter. */
export function normalizeTargetingFilter(raw: any): OutreachTargetingFilter {
  return {
    geographies: cleanList(raw?.geographies),
    industries: cleanList(raw?.industries),
    segments: cleanList(raw?.segments),
    namedAccounts: cleanList(raw?.namedAccounts),
    targetRoles: cleanList(raw?.targetRoles),
  };
}

// ── Channel normalization ────────────────────────────────────────────────────

const VALID_CHANNELS: OutreachChannel[] = ["email", "linkedin"];

export function normalizeChannels(raw: unknown): OutreachChannel[] {
  if (!Array.isArray(raw)) return ["email"];
  const out = raw
    .map((x) => String(x).trim().toLowerCase())
    .filter((x): x is OutreachChannel => (VALID_CHANNELS as string[]).includes(x));
  return out.length > 0 ? Array.from(new Set(out)) : ["email"];
}

// ── Assemble a campaign brief from interview answers ─────────────────────────

export interface AssembledCampaign {
  goalType: OutreachGoalType;
  archetype: CadenceArchetype;
  cadence: DefaultCadence;
  targetingFilter: OutreachTargetingFilter;
  channels: OutreachChannel[];
}

/**
 * Turn raw interview answers into the deterministic parts of a campaign:
 * goal type, cadence archetype + default steps, targeting filter, channels.
 */
export function assembleCampaign(answers: {
  goal?: string | null;
  refinements?: any;
  channels?: unknown;
}): AssembledCampaign {
  const goalType = classifyGoalType(answers.goal);
  const archetype = archetypeForGoal(goalType);
  return {
    goalType,
    archetype,
    cadence: defaultCadence(archetype),
    targetingFilter: normalizeTargetingFilter(answers.refinements),
    channels: normalizeChannels(answers.channels),
  };
}
