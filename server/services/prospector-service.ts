/**
 * Prospector service.
 *
 * Researches and ICP-scores a prospect: deterministic scoring (prospector-core)
 * grounded in the campaign's ICP persona + targeting filter, plus an AI research
 * dossier grounded in strategic context. Advances the prospect state machine
 * `new -> researched` (or `-> dormant` when disqualified). The pure scoring math
 * lives in `prospector-core.ts`.
 */

import { db } from "../db";
import { prospects, outreachCampaigns, personas, type ProspectWithContact } from "@shared/schema";
import { eq } from "drizzle-orm";
import { completeForFeature } from "./ai-provider";
import { loadStrategicContext, formatStrategicContextForPrompt } from "./strategic-context";
import { buildIcpCriteria, scoreProspect, scoreProspectAgainstAll, type ScoredProspect, type ScoredProspectWithPersona, type PersonaRef, type IcpCriteria, type ProspectAttributes } from "./prospector-core";

const SYSTEM_PROMPT = `You are a B2B sales researcher. Write a tight, factual prospect dossier for a seller preparing 1:1 outreach. Lead with why this person fits (or doesn't) the ICP, then the few facts that would shape a first message. Be specific and cite what you're inferring from. Never fabricate — if something is unknown, say "unknown". No filler, no hype, no clichés. 180 words max.`;

// ---------------------------------------------------------------------------
// AI semantic role matching — used ONLY during the explicit Research step,
// never during import-time scoring (which must stay synchronous and cheap).
// ---------------------------------------------------------------------------

/**
 * In-memory cache keyed by `"${normalisedTitle}|||${sortedRoles.join('|')}"`.
 * Caches both positive (string note) and negative (null) results so the same
 * title+persona pair is never re-sent to the AI within the process lifetime.
 */
const semanticRoleCache = new Map<string, { note: string; matchedRole: string } | null>();

/**
 * Ask the AI whether the prospect's title is a semantic match for any of the
 * ICP roles. Returns the matched role string and a note on a confident match,
 * or null.
 *
 * Only called when literal substring matching AND the synchronous synonym/
 * concept-overlap check both fail. Results are cached per title+roles pair.
 *
 * The AI is asked to return the EXACT role text it matched so the caller can
 * rescore against the right persona rather than always defaulting to the first.
 */
async function aiSemanticRoleCheck(
  tenantDomain: string,
  title: string,
  roles: string[],
): Promise<{ note: string; matchedRole: string } | null> {
  if (!title || roles.length === 0) return null;

  const cacheKey = `${title.trim().toLowerCase()}|||${[...roles].sort().join("|").toLowerCase()}`;
  if (semanticRoleCache.has(cacheKey)) return semanticRoleCache.get(cacheKey) as { note: string; matchedRole: string } | null;

  try {
    const prompt = [
      "You are scoring a B2B prospect's job title against ICP persona roles.",
      `Prospect title: "${title}"`,
      `ICP roles to evaluate (numbered for reference):`,
      ...roles.map((r, i) => `  ${i + 1}. "${r}"`),
      "",
      "Respond with ONE line only:",
      "- If the title is a clear semantic match (synonyms, industry-specific phrasing for the SAME function — not just the same seniority level): MATCH: <copy the exact role text from the list>: <1-sentence explanation>",
      "- Otherwise: NO_MATCH",
      "",
      "Important: seniority words alone (manager, director, VP, lead, head) do NOT make a match. 'Engineering Manager' must NOT match 'Sales Manager'.",
    ].join("\n");

    const result = await completeForFeature("prospect_research", prompt, {
      tenantDomain,
      maxTokens: 100,
    });

    const text = result.text.trim();
    let match: { note: string; matchedRole: string } | null = null;
    if (text.startsWith("MATCH:")) {
      const rest = text.slice(6).trim();
      // Format: <exact role>: <explanation>
      const colonIdx = rest.indexOf(":");
      if (colonIdx > 0) {
        const returnedRole = rest.slice(0, colonIdx).trim();
        const explanation = rest.slice(colonIdx + 1).trim();
        // Find the closest match in the actual roles list (case-insensitive exact, then partial).
        const matchedRole =
          roles.find((r) => r.toLowerCase() === returnedRole.toLowerCase()) ??
          roles.find((r) => returnedRole.toLowerCase().includes(r.toLowerCase().slice(0, 8))) ??
          null;
        if (matchedRole) {
          match = { note: `AI semantic match to "${matchedRole}": ${explanation}`, matchedRole };
        }
      }
    }
    semanticRoleCache.set(cacheKey, match);
    return match;
  } catch (err) {
    // Non-fatal: fall back gracefully if the AI call fails.
    console.warn("[prospector] AI semantic role check failed:", err);
    return null;
  }
}

export interface ResearchProspectResult {
  prospect: ProspectWithContact;
  scored: ScoredProspect;
  dossier: string;
  usage: { inputTokens: number; outputTokens: number };
  model: string;
  provider: string;
}

/**
 * Score + research one prospect. Loads the campaign's ICP persona and targeting
 * filter, scores deterministically, generates a grounded dossier, and persists
 * the result with the new state.
 */
export async function researchProspect(
  tenantDomain: string,
  prospectId: string,
  opts: { isDefaultMarket?: boolean } = {},
): Promise<ResearchProspectResult> {
  const { getProspectWithContact } = await import("./prospect-contact-service");
  const prospect = await getProspectWithContact(prospectId);
  if (!prospect || prospect.tenantDomain !== tenantDomain) {
    throw new Error("Prospect not found");
  }

  const [campaign] = await db
    .select()
    .from(outreachCampaigns)
    .where(eq(outreachCampaigns.id, prospect.campaignId));
  if (!campaign) throw new Error("Campaign not found");

  // Load all personas targeted by this campaign. Score the prospect against
  // each one independently and keep the best result — a multi-persona campaign
  // (e.g. M365 Admins + Systems Integrators + Practice Leads) should not
  // penalise a perfect-fit prospect just because they don't match the one
  // persona that happens to have isIcp=true.
  const personaIds = campaign.targetPersonaIds ?? [];
  let campaignPersonas: PersonaRef[] = [];
  if (personaIds.length > 0) {
    const rows = await db
      .select({ id: personas.id, name: personas.name, role: personas.role, industry: personas.industry, companySize: personas.companySize })
      .from(personas)
      .where(eq(personas.tenantDomain, tenantDomain));
    campaignPersonas = rows.filter((p) => personaIds.includes(p.id));
  }

  const attrs: ProspectAttributes = {
    title: prospect.title,
    companyName: prospect.companyName,
    // Geography/industry/segment aren't first-class prospect columns yet; the
    // research signals jsonb can carry them. Fall back to what we have.
    geography: (prospect.signals as any)?.geography ?? null,
    industry: (prospect.signals as any)?.industry ?? null,
    segment: (prospect.signals as any)?.segment ?? null,
    email: prospect.email,
    linkedinUrl: prospect.linkedinUrl,
  };

  let scored: ScoredProspectWithPersona = scoreProspectAgainstAll(
    campaignPersonas,
    campaign.targetingFilter ?? undefined,
    attrs,
  );

  // ── AI semantic role fallback (Research-only) ───────────────────────────
  // When the synchronous scorer gave 0 role points (literal + concept-overlap
  // both failed) and the prospect has a title, ask the AI for a one-shot
  // semantic judgment.
  //
  // On a confident match the AI returns the EXACT role text it matched. We
  // patch that role into the title so the literal matcher will pass it, then
  // rescore against ALL personas so scoreProspectAgainstAll picks the best
  // persona correctly — persona metadata stays consistent with the signals.
  const roleSignal = scored.breakdown.signals.find((s) => s.key === "role");
  const hasTitleNoRolePoints = prospect.title && roleSignal && !roleSignal.matched && !roleSignal.absent;
  if (hasTitleNoRolePoints) {
    // Collect all ICP roles across all targeted personas + filter (deduped).
    const allRoleSet = new Set<string>();
    for (const p of campaignPersonas) {
      if (p.role) allRoleSet.add(p.role);
    }
    for (const r of campaign.targetingFilter?.targetRoles ?? []) {
      allRoleSet.add(r);
    }
    const allRoles = Array.from(allRoleSet);

    if (allRoles.length > 0) {
      const aiMatch = await aiSemanticRoleCheck(tenantDomain, prospect.title!, allRoles);
      if (aiMatch) {
        // Patch the title with the AI-matched role so the literal matcher in
        // scoreProspectAgainstAll will award role points for the right persona.
        const patchedAttrs: ProspectAttributes = {
          ...attrs,
          title: `${prospect.title} ${aiMatch.matchedRole}`,
        };
        // Re-run the full multi-persona scorer so best persona is correctly selected.
        const rescored = scoreProspectAgainstAll(
          campaignPersonas,
          campaign.targetingFilter ?? undefined,
          patchedAttrs,
        );
        // Replace the role signal note with the AI reasoning and mark it semantic.
        rescored.breakdown.signals = rescored.breakdown.signals.map((s) =>
          s.key === "role" ? { ...s, note: aiMatch.note } : s,
        );
        rescored.breakdown.semanticRoleMatch = true;
        // Use the rescored result in full — matchedPersonaId/Name are now
        // derived from the actual best persona for the patched title.
        scored = rescored;
      }
    }
  }

  // Grounded dossier. Strategic context gives positioning/voice/competitive
  // intel; the prospect facts + score frame the ask.
  const strategicCtx = await loadStrategicContext(
    tenantDomain,
    campaign.marketId || undefined,
    opts.isDefaultMarket,
  );
  const strategicBlock = formatStrategicContextForPrompt(strategicCtx);

  // Attach matchedPersonaName to the breakdown so the persisted record and
  // the read-only dossier route can surface which persona the prospect best fit
  // without re-running the scorer.
  if (scored.matchedPersonaName) {
    scored.breakdown = { ...scored.breakdown, matchedPersonaName: scored.matchedPersonaName };
  }

  // Human-readable signal summary for the dossier prompt, distinguishing
  // unknown signals from mismatches.
  const signalLines = scored.breakdown.signals
    .filter((s) => s.key !== "email" && s.key !== "linkedin")
    .map((s) => {
      if (s.matched) return `${s.label}: ✓ matched${s.note ? ` (${s.note})` : ""}`;
      if (s.absent) return `${s.label}: unknown (no data available for this prospect)`;
      return `${s.label}: ✗ did not match`;
    });

  // Contact-info-only note: score = email + linkedin only, no ICP signals.
  const contactInfoOnlyScore = (scored.breakdown.signals.find((s) => s.key === "email")?.matched ? 12 : 0)
    + (scored.breakdown.signals.find((s) => s.key === "linkedin")?.matched ? 8 : 0);
  const isContactInfoOnly = scored.score === contactInfoOnlyScore && scored.score > 0
    && scored.breakdown.signals.filter((s) => !["email", "linkedin"].includes(s.key) && s.matched).length === 0;

  const prospectBlock = [
    "## Prospect",
    `Name: ${prospect.name}`,
    prospect.title ? `Title: ${prospect.title}` : "",
    prospect.companyName ? `Company: ${prospect.companyName}` : "",
    prospect.linkedinUrl ? `LinkedIn: ${prospect.linkedinUrl}` : "",
    "",
    "## ICP fit (computed)",
    `Score: ${scored.score}/100 (threshold ${scored.breakdown.threshold}) — ${scored.disqualified ? "DISQUALIFIED" : scored.qualified ? "qualified" : "below threshold"}`,
    scored.matchedPersonaName ? `Best-match ICP persona: ${scored.matchedPersonaName}` : "",
    ...signalLines,
    isContactInfoOnly ? "NOTE: Only contact-presence signals matched — no ICP fit signals scored. This may indicate missing data rather than a definitive mismatch." : "",
    scored.breakdown.partnerFit
      ? `PARTNER/CHANNEL FLAG: ${scored.breakdown.partnerFitNote ?? "This prospect appears to be at a consulting/SI/agency firm. Consider recommending a partner or channel engagement approach rather than a direct end-user pitch."}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  const goalBlock = campaign.salesGoal
    ? `## Campaign goal\n${campaign.salesGoal}`
    : "";

  const prompt = [
    "Write the prospect dossier.",
    strategicBlock,
    goalBlock,
    prospectBlock,
  ]
    .filter(Boolean)
    .join("\n\n");

  const result = await completeForFeature("prospect_research", prompt, {
    tenantDomain,
    systemPrompt: SYSTEM_PROMPT,
    maxTokens: 700,
  });

  const dossier = result.text.trim();
  const nextStatus = scored.disqualified ? "dormant" : "researched";

  const [updated] = await db
    .update(prospects)
    .set({
      icpScore: scored.score,
      scoreBreakdown: scored.breakdown,
      disqualifiedReason: scored.disqualifiedReason ?? null,
      researchDossier: dossier,
      status: nextStatus,
      updatedAt: new Date(),
    })
    .where(eq(prospects.id, prospectId))
    .returning();

  return {
    prospect: { ...prospect, ...updated },
    scored,
    dossier,
    usage: { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens },
    model: result.model,
    provider: result.provider,
  };
}
