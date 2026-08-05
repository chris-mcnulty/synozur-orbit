/**
 * Multi-Touch Attribution Service
 *
 * Implements four rule-based attribution models over an ordered sequence of
 * marketing touchpoints that precede a conversion event:
 *
 *   • first-touch   — 100 % credit to the first touchpoint
 *   • last-touch    — 100 % credit to the last touchpoint (same as the
 *                     existing single-touch rollup, so existing reports are
 *                     preserved as "last-touch")
 *   • linear        — equal credit split across all touchpoints
 *   • position-based (U-shaped) — 40 % to first, 40 % to last, 20 %
 *                     split equally across middle touchpoints
 *
 * Conversion events recognised by default: form_submit, lifecycle stage
 * reaching MQL or SQL, email_click on campaign emails.
 *
 * Usage
 * ─────
 *   const credits = allocateCredit(touchpoints, "linear");
 *   // credits[i].credit is a fraction [0, 1] summing to 1.0
 */

export type AttributionModel = "first-touch" | "last-touch" | "linear" | "position-based";

export const ATTRIBUTION_MODELS: AttributionModel[] = [
  "first-touch",
  "last-touch",
  "linear",
  "position-based",
];

export const ATTRIBUTION_MODEL_LABELS: Record<AttributionModel, string> = {
  "first-touch": "First Touch",
  "last-touch": "Last Touch",
  "linear": "Linear",
  "position-based": "Position-Based (U-Shaped)",
};

/** A single marketing touchpoint in a contact's journey. */
export interface Touchpoint {
  /** Unique event id */
  id: string;
  /** When the interaction happened */
  occurredAt: Date;
  /** Event type (form_submit, email_click, link_click, …) */
  eventType: string;
  /** Channel / source label (email, social, web, …) */
  channel: string;
  /** Campaign id this touchpoint is attributed to (may be null) */
  campaignId: string | null;
  /** Human-readable campaign name */
  campaignName: string | null;
  /** Any extra metadata stored on the event */
  metadata?: Record<string, unknown> | null;
}

/** A touchpoint enriched with its credit share under a given model. */
export interface CreditedTouchpoint extends Touchpoint {
  /** Fraction of conversion credit [0, 1] */
  credit: number;
  /** Credit as a percentage string for display ("40.0%") */
  creditPct: string;
}

/**
 * Allocate conversion credit across an ordered list of touchpoints.
 *
 * @param touchpoints  Ordered (ascending) touchpoints preceding a conversion.
 *                     Must have at least one element.
 * @param model        The attribution model to apply.
 * @returns            A new array with `credit` [0, 1] added to each element.
 *                     Credits sum to 1.0 (within floating-point precision).
 */
export function allocateCredit(
  touchpoints: Touchpoint[],
  model: AttributionModel,
): CreditedTouchpoint[] {
  if (touchpoints.length === 0) return [];

  const n = touchpoints.length;
  let weights: number[];

  switch (model) {
    case "first-touch":
      weights = touchpoints.map((_, i) => (i === 0 ? 1 : 0));
      break;

    case "last-touch":
      weights = touchpoints.map((_, i) => (i === n - 1 ? 1 : 0));
      break;

    case "linear":
      weights = touchpoints.map(() => 1 / n);
      break;

    case "position-based": {
      // U-shaped: 40 % first, 40 % last, 20 % spread across middle.
      if (n === 1) {
        weights = [1];
      } else if (n === 2) {
        weights = [0.5, 0.5];
      } else {
        const middleShare = 0.2 / (n - 2);
        weights = touchpoints.map((_, i) => {
          if (i === 0) return 0.4;
          if (i === n - 1) return 0.4;
          return middleShare;
        });
      }
      break;
    }

    default:
      weights = touchpoints.map(() => 1 / n);
  }

  return touchpoints.map((tp, i) => ({
    ...tp,
    credit: weights[i],
    creditPct: `${(weights[i] * 100).toFixed(1)}%`,
  }));
}

/** Aggregate credited touchpoints by campaign. */
export interface CampaignCredit {
  campaignId: string | null;
  campaignName: string | null;
  credit: number;
  touchpoints: number;
}

export function aggregateByCampaign(credited: CreditedTouchpoint[]): CampaignCredit[] {
  const map = new Map<string, CampaignCredit>();

  for (const tp of credited) {
    const key = tp.campaignId ?? "__none__";
    const existing = map.get(key);
    if (existing) {
      existing.credit += tp.credit;
      existing.touchpoints += 1;
    } else {
      map.set(key, {
        campaignId: tp.campaignId,
        campaignName: tp.campaignName,
        credit: tp.credit,
        touchpoints: 1,
      });
    }
  }

  return Array.from(map.values()).sort((a, b) => b.credit - a.credit);
}

/**
 * Derive a human-readable channel label from an event type and source string.
 */
export function deriveChannel(eventType: string, source: string | null | undefined): string {
  if (eventType === "email_sent" || eventType === "email_open" || eventType === "email_click") {
    return "Email";
  }
  if (eventType === "social_engage") return "Social";
  if (eventType === "form_submit") return "Web (Form)";
  if (eventType === "page_view") return "Web";
  if (eventType === "link_click") {
    // try to classify by source
    const s = (source ?? "").toLowerCase();
    if (s.includes("linkedin")) return "LinkedIn";
    if (s.includes("twitter") || s.includes("x.com")) return "X / Twitter";
    if (s.includes("email")) return "Email";
    return "Link";
  }
  return source ?? eventType;
}

/**
 * Whether a contact event qualifies as a conversion.
 * Used by the rollup query to identify the conversion point in a timeline.
 *
 * Supported conversions:
 *  - form_submit  — a web form submission recorded via the ingest webhook
 *
 * NOTE: lifecycle_change is intentionally NOT supported here. Although the
 * HubSpot sync advances a contact's lifecycleStage column (subscriber → lead
 * → mql → sql …), it does NOT append a `lifecycle_change` event row to
 * marketing_contact_events, so that event type is never present in the
 * timeline. Detecting lifecycle-based conversions requires querying the
 * contact's current lifecycleStage column rather than the event stream;
 * that is out of scope for the event-level attribution model and is tracked
 * as a separate follow-up task.
 */
export function isConversionEvent(
  eventType: string,
  _metadata: Record<string, unknown> | null | undefined,
): boolean {
  return eventType === "form_submit";
}
