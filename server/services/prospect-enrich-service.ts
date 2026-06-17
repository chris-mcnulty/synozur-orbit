/**
 * Prospect contact enrichment.
 *
 * Backfills the contact details a 1:1 touch needs — a LinkedIn profile URL and
 * an email — when a prospect arrives bare (manual entry, or a HubSpot contact
 * without them). Uses the same grounded web-search backend as discovery; it
 * only keeps a value it actually found on a real public source and cites it.
 * It never guesses an email from a name+domain pattern, and only fills blanks
 * (existing values are never overwritten). The enriched email still flows
 * through the normal compliance + suppression scan at compose/approve time.
 *
 * Pure prompt/parse/validate helpers are exported for clarity and reuse.
 */

import { db } from "../db";
import { prospects, type Prospect, type ProspectSignals } from "@shared/schema";
import { eq } from "drizzle-orm";
import { completeWithWebSearch, isWebSearchAvailable } from "./ai-provider";
import { isValidLinkedInProfileUrl } from "@shared/linkedin-outreach";

export class EnrichError extends Error {
  constructor(message: string, readonly code: "web_search_unavailable" | "not_found" | "nothing_missing") {
    super(message);
    this.name = "EnrichError";
  }
}

const SYSTEM_PROMPT =
  `You are a B2B contact researcher. You find a specific person's public ` +
  `professional contact details, grounded in live public web sources. You NEVER ` +
  `guess or fabricate. Only return a value you actually found stated on a real ` +
  `source (a company team/leadership page, the person's own LinkedIn profile, a ` +
  `conference speaker bio, a press release). NEVER construct an email from a ` +
  `name + company-domain pattern. If you cannot verify a field from a real ` +
  `source, return null for it. Respond with strict JSON only.`;

export interface EnrichTargets {
  /** Find a LinkedIn profile URL (only when missing). */
  linkedin: boolean;
  /** Find an email (only when missing). */
  email: boolean;
}

export interface EnrichLookup {
  linkedinUrl: string | null;
  linkedinEvidenceUrl: string | null;
  email: string | null;
  emailEvidenceUrl: string | null;
  notes?: string;
}

/** Build the enrichment prompt for the missing fields only. */
export function buildEnrichPrompt(
  prospect: { name: string; title?: string | null; companyName?: string | null; linkedinUrl?: string | null },
  targets: EnrichTargets,
): string {
  const want: string[] = [];
  if (targets.linkedin) want.push("a LinkedIn profile URL (linkedin.com/in/…) for THIS person at THIS company");
  if (targets.email) want.push("a work email address that is actually published on a real page");

  return [
    "Find public professional contact details for this person. Only return the fields requested.",
    "",
    `Name: ${prospect.name}`,
    prospect.title ? `Title: ${prospect.title}` : "",
    prospect.companyName ? `Company: ${prospect.companyName}` : "",
    prospect.linkedinUrl ? `Known LinkedIn (for disambiguation): ${prospect.linkedinUrl}` : "",
    "",
    `Find: ${want.join("; ")}.`,
    "",
    "Respond with STRICT JSON and nothing else:",
    '{ "linkedinUrl": string|null, "linkedinEvidenceUrl": string|null, "email": string|null, "emailEvidenceUrl": string|null, "notes": string }',
    "",
    "Rules:",
    "- linkedinUrl must be the real profile of THIS person at THIS company; otherwise null.",
    "- email must be an address you SAW published on a real page — never a guessed pattern. Cite emailEvidenceUrl. If unsure, null.",
    "- Do not include any field you were not asked to find.",
  ]
    .filter(Boolean)
    .join("\n");
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isHttpUrl(v: unknown): v is string {
  if (typeof v !== "string" || !v.trim()) return false;
  try {
    const u = new URL(v.trim());
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/** Extract the first JSON object from a model response (tolerates code fences). */
export function extractJsonObject(text: string): any | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * Parse + validate a raw enrichment response into accepted values. A LinkedIn
 * URL must be a real profile URL; an email is accepted only when it is
 * well-formed AND cited with an evidence URL (our guard against guessed
 * patterns). Returns only the requested-and-found fields.
 */
export function parseEnrichLookup(raw: string, targets: EnrichTargets): EnrichLookup {
  const obj = extractJsonObject(raw) ?? {};
  const linkedinUrl =
    targets.linkedin && isValidLinkedInProfileUrl(obj.linkedinUrl) ? String(obj.linkedinUrl).trim() : null;

  let email: string | null = null;
  let emailEvidenceUrl: string | null = null;
  if (targets.email && typeof obj.email === "string") {
    const candidate = obj.email.trim().toLowerCase();
    // Require a citation — an email with no source is treated as a guess.
    if (EMAIL_RE.test(candidate) && isHttpUrl(obj.emailEvidenceUrl)) {
      email = candidate;
      emailEvidenceUrl = String(obj.emailEvidenceUrl).trim();
    }
  }

  return {
    linkedinUrl,
    linkedinEvidenceUrl: isHttpUrl(obj.linkedinEvidenceUrl) ? String(obj.linkedinEvidenceUrl).trim() : null,
    email,
    emailEvidenceUrl,
    notes: typeof obj.notes === "string" ? obj.notes.slice(0, 500) : undefined,
  };
}

export interface EnrichResult {
  prospect: Prospect;
  found: { linkedinUrl: boolean; email: boolean };
  lookup: EnrichLookup;
  usage: { inputTokens: number; outputTokens: number };
  searchCount: number;
  model: string;
  provider: string;
}

/**
 * Enrich one prospect's missing contact details from the public web. Only
 * resolves fields that are currently blank, persists what was confidently found
 * (with evidence appended to `signals.sources`), and returns the result.
 */
export async function enrichProspectContact(
  tenantDomain: string,
  prospectId: string,
): Promise<EnrichResult> {
  const [prospect] = await db.select().from(prospects).where(eq(prospects.id, prospectId));
  if (!prospect || prospect.tenantDomain !== tenantDomain) throw new Error("Prospect not found");

  const targets: EnrichTargets = {
    linkedin: !prospect.linkedinUrl,
    email: !prospect.email,
  };
  if (!targets.linkedin && !targets.email) {
    throw new EnrichError("This prospect already has a LinkedIn profile and an email.", "nothing_missing");
  }
  if (!isWebSearchAvailable()) {
    throw new EnrichError(
      "Contact enrichment needs the AI web-search provider, which isn't configured. Add the LinkedIn URL or email manually.",
      "web_search_unavailable",
    );
  }

  const prompt = buildEnrichPrompt(prospect, targets);
  const result = await completeWithWebSearch(prompt, {
    systemPrompt: SYSTEM_PROMPT,
    maxTokens: 1024,
    maxSearches: 4,
  });
  const lookup = parseEnrichLookup(result.text, targets);

  // Only fill blanks; build the persisted patch + evidence trail.
  const patch: Partial<typeof prospects.$inferInsert> = {};
  const evidence: string[] = [];
  if (targets.linkedin && lookup.linkedinUrl) {
    patch.linkedinUrl = lookup.linkedinUrl;
    if (lookup.linkedinEvidenceUrl) evidence.push(lookup.linkedinEvidenceUrl);
  }
  if (targets.email && lookup.email) {
    patch.email = lookup.email;
    if (lookup.emailEvidenceUrl) evidence.push(lookup.emailEvidenceUrl);
  }

  let updated = prospect;
  if (Object.keys(patch).length > 0) {
    const signals: ProspectSignals = { ...(prospect.signals ?? {}) };
    if (evidence.length > 0) {
      const sources = Array.isArray(signals.sources) ? signals.sources : [];
      signals.sources = Array.from(new Set([...sources, ...evidence]));
    }
    const [row] = await db
      .update(prospects)
      .set({ ...patch, signals, updatedAt: new Date() })
      .where(eq(prospects.id, prospect.id))
      .returning();
    updated = row;
  }

  return {
    prospect: updated,
    found: { linkedinUrl: !!patch.linkedinUrl, email: !!patch.email },
    lookup,
    usage: { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens },
    searchCount: result.searchCount,
    model: result.model,
    provider: result.provider,
  };
}
