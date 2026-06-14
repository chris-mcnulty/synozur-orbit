/**
 * Sales Outreach Readiness — pure scoring core.
 *
 * The Cowork sales-harness makes you hand-author config (ICP, voice DNA,
 * connections) before the loop runs. Orbit derives that readiness from data
 * that already exists and surfaces fix hints for whatever is missing or thin —
 * instead of a config interview. Downstream outreach features (prospector,
 * composer, cadence) ground on this data, so a thin field here means generic,
 * off-voice, or unsendable outreach.
 *
 * No I/O and no DB imports, so it is unit-testable in isolation. The async
 * loader that gathers the raw signals lives in `sales-outreach-readiness.ts`.
 *
 * Reuses the shared readiness shape from the marketing readiness core.
 */

import {
  type ReadinessStatus,
  type ReadinessItem,
  type ReadinessReport,
} from "./marketing-context-readiness-core";

export {
  type ReadinessStatus,
  type ReadinessItem,
  type ReadinessReport,
} from "./marketing-context-readiness-core";

/** Raw signals about a tenant's (and the current seller's) outreach readiness. */
export interface SalesReadinessInputs {
  personaCount: number;
  icpPersonaCount: number;
  messagingFrameworkGenerated: boolean;
  productCount: number;
  /** Battlecards that carry objection/talk-track material for rebuttals. */
  battlecardWithObjectionsCount: number;
  /** Any outbound/brand voice profile defined for the tenant. */
  voiceProfileCount: number;
  /** A voice profile owned by the current seller ("sound like me"). */
  hasPersonalVoiceProfile: boolean;
  /** HubSpot CRM connected — the primary prospect source. */
  hubspotConnected: boolean;
  /** The current seller has a delegated Graph mailbox token. */
  mailboxConnected: boolean;
  /** That token grants a Mail.* scope (can create Outlook drafts). */
  mailboxCanDraft: boolean;
}

const STATUS_WEIGHT: Record<ReadinessStatus, number> = {
  ready: 1,
  thin: 0.5,
  missing: 0,
};

/** Pure scoring core — turns raw signals into a structured readiness report. */
export function deriveSalesReadiness(input: SalesReadinessInputs): ReadinessReport {
  const items: ReadinessItem[] = [];

  // ICP / personas — who we target and disqualify against.
  items.push({
    key: "icp",
    label: "Ideal Customer Profile (Personas)",
    status: input.personaCount === 0 ? "missing" : input.icpPersonaCount === 0 ? "thin" : "ready",
    detail:
      input.personaCount === 0
        ? "No buyer personas defined — prospect scoring has nothing to score against."
        : input.icpPersonaCount === 0
          ? `${input.personaCount} persona(s), but none flagged as the ICP.`
          : `${input.icpPersonaCount} ICP persona(s) defined.`,
    fixHint: "Define at least one buyer persona and mark your primary one as the ICP.",
    fixPath: "/app/marketing/personas",
  });

  // Messaging framework — the positioning + value prop the composer draws on.
  items.push({
    key: "messagingFramework",
    label: "Messaging Framework",
    status: input.messagingFrameworkGenerated ? "ready" : "missing",
    detail: input.messagingFrameworkGenerated
      ? "Messaging framework generated."
      : "No messaging framework yet — outreach copy will lack a grounded value prop.",
    fixHint: "Generate the messaging framework so drafts carry consistent positioning.",
    fixPath: "/app/marketing/messaging-framework",
  });

  // Products — what we are actually selling.
  items.push({
    key: "products",
    label: "Products / Offerings",
    status: input.productCount === 0 ? "missing" : "ready",
    detail: input.productCount === 0
      ? "No products defined."
      : `${input.productCount} product(s) defined.`,
    fixHint: "Add the products/services this outreach is about.",
    fixPath: "/app/products",
  });

  // Objection material — talk tracks for rebuttals in follow-ups.
  items.push({
    key: "objections",
    label: "Objection / Talk-Track Material",
    status: input.battlecardWithObjectionsCount === 0 ? "thin" : "ready",
    detail: input.battlecardWithObjectionsCount === 0
      ? "No battlecards with objections — follow-ups can't ground rebuttals."
      : `${input.battlecardWithObjectionsCount} battlecard(s) with objection material.`,
    fixHint: "Generate battlecards so the composer can reference objections and talk tracks.",
    fixPath: "/app/battlecards",
  });

  // Outbound voice — so drafts sound human and on-brand (personal preferred).
  items.push({
    key: "voiceProfile",
    label: "Outbound Voice",
    status: input.voiceProfileCount === 0
      ? "missing"
      : input.hasPersonalVoiceProfile
        ? "ready"
        : "thin",
    detail: input.voiceProfileCount === 0
      ? "No voice profile — drafts will read as generic AI."
      : input.hasPersonalVoiceProfile
        ? "Personal voice profile set — drafts sound like you."
        : "Only a firm-level voice profile — connect your mailbox to extract your personal voice.",
    fixHint: "Connect your mailbox and extract your personal voice, or set a firm voice profile.",
    fixPath: "/app/sales/outreach/settings",
  });

  // HubSpot — the primary prospect source.
  items.push({
    key: "hubspot",
    label: "HubSpot CRM Connection",
    status: input.hubspotConnected ? "ready" : "missing",
    detail: input.hubspotConnected
      ? "HubSpot is connected — contacts and companies can be imported as prospects."
      : "HubSpot not connected — no CRM source for prospects.",
    fixHint: "Connect HubSpot to source and sync prospects.",
    fixPath: "/app/settings",
  });

  // Mailbox — where approved drafts land for human send.
  items.push({
    key: "mailbox",
    label: "Outlook Mailbox (per-seller)",
    status: !input.mailboxConnected ? "missing" : input.mailboxCanDraft ? "ready" : "thin",
    detail: !input.mailboxConnected
      ? "Your mailbox isn't connected — drafts can't be created in Outlook."
      : input.mailboxCanDraft
        ? "Mailbox connected with draft permission."
        : "Mailbox connected, but without mail permission — reconnect to grant draft access.",
    fixHint: "Connect your Microsoft mailbox (grants draft creation + voice extraction).",
    fixPath: "/app/sales/outreach/settings",
  });

  const readyCount = items.filter((i) => i.status === "ready").length;
  const thinCount = items.filter((i) => i.status === "thin").length;
  const missingCount = items.filter((i) => i.status === "missing").length;
  const totalCount = items.length;

  const weighted = items.reduce((sum, i) => sum + STATUS_WEIGHT[i.status], 0);
  const score = totalCount === 0 ? 0 : Math.round((weighted / totalCount) * 100);
  const overall: ReadinessReport["overall"] =
    score >= 85 ? "ready" : score >= 50 ? "partial" : "incomplete";

  return { items, readyCount, thinCount, missingCount, totalCount, score, overall };
}
