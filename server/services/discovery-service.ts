/**
 * Prospect discovery service.
 *
 * Orchestrates outbound discovery: load the campaign's ICP criteria, run a
 * discovery backend (free web search by default; Sales Navigator when the
 * LinkedIn MCP is wired), dedupe against prospects already on the campaign,
 * ICP-score each candidate so the seller sees fit before importing, and — on a
 * separate, explicit step — import the chosen candidates as `new` prospects.
 *
 * Scoring reuses `prospector-core` unchanged; imported prospects flow into the
 * existing research/compose/cadence pipeline.
 */

import { db } from "../db";
import { prospects, outreachCampaigns, personas, type Prospect } from "@shared/schema";
import { eq } from "drizzle-orm";
import { buildIcpCriteria, scoreProspect, type ScoredProspect } from "./prospector-core";
import {
  candidateToAttributes,
  dedupeCandidates,
  normalizeLimit,
  type DiscoveryBackendId,
  type DiscoveryCandidate,
  type DiscoverySearchInput,
} from "./discovery-provider-core";
import { searchWeb, isWebSearchAvailable, webDiscoveryReason } from "./web-discovery-provider";
import {
  searchSalesNavigator,
  isSalesNavigatorAvailable,
  salesNavigatorReason,
  SalesNavDiscoveryError,
} from "./salesnav-discovery-provider";
import {
  searchApollo,
  isApolloAvailable,
  apolloReason,
  ApolloDiscoveryError,
} from "./apollo-discovery-provider";

/** A discovered candidate with its computed ICP fit (preview, not persisted). */
export interface ScoredDiscoveryCandidate {
  candidate: DiscoveryCandidate;
  scored: ScoredProspect;
}

export interface DiscoverResult {
  backend: DiscoveryBackendId;
  candidates: ScoredDiscoveryCandidate[];
  /** Raw count found before dedup/scoring — lets the UI explain "0 new". */
  foundCount: number;
  /** Candidates silently dropped by name heuristics (single-token, company names, role labels). */
  droppedCount: number;
  usage: { inputTokens: number; outputTokens: number };
  searchCount: number;
  model: string | null;
  provider: string | null;
}

export interface DiscoveryBackendStatus {
  id: DiscoveryBackendId;
  label: string;
  available: boolean;
  reason: string;
}

/** Report which discovery backends are available (drives the UI). */
export function getDiscoveryBackends(): DiscoveryBackendStatus[] {
  return [
    { id: "apollo", label: "Apollo", available: isApolloAvailable(), reason: apolloReason() },
    { id: "web", label: "Web discovery (free)", available: isWebSearchAvailable(), reason: webDiscoveryReason() },
    { id: "salesnav", label: "Sales Navigator", available: isSalesNavigatorAvailable(), reason: salesNavigatorReason() },
  ];
}

/** Load a campaign and flatten its ICP persona + targeting filter into criteria. */
async function loadCampaignContext(tenantDomain: string, campaignId: string) {
  const [campaign] = await db
    .select()
    .from(outreachCampaigns)
    .where(eq(outreachCampaigns.id, campaignId));
  if (!campaign || campaign.tenantDomain !== tenantDomain) {
    throw new Error("Campaign not found");
  }

  // Prefer the persona flagged isIcp among the campaign's targets (mirrors
  // prospector-service so discovery and research score against the same ICP).
  let icpPersona: { role?: string | null; industry?: string | null; companySize?: string | null } | undefined;
  const personaIds = campaign.targetPersonaIds ?? [];
  if (personaIds.length > 0) {
    const rows = await db
      .select({ id: personas.id, role: personas.role, industry: personas.industry, companySize: personas.companySize, isIcp: personas.isIcp })
      .from(personas)
      .where(eq(personas.tenantDomain, tenantDomain));
    const inCampaign = rows.filter((p) => personaIds.includes(p.id));
    icpPersona = inCampaign.find((p) => p.isIcp) ?? inCampaign[0];
  }

  const criteria = buildIcpCriteria(icpPersona, campaign.targetingFilter ?? undefined);
  return { campaign, criteria };
}

/**
 * Discover net-new prospects for a campaign. Returns scored, deduped candidates
 * for the seller to review — nothing is persisted here (see `importDiscovered`).
 */
export async function discoverProspects(
  tenantDomain: string,
  campaignId: string,
  opts: { backend?: DiscoveryBackendId; limit?: number } = {},
): Promise<DiscoverResult> {
  const { campaign, criteria } = await loadCampaignContext(tenantDomain, campaignId);
  const limit = normalizeLimit(opts.limit);

  const input: DiscoverySearchInput = {
    criteria,
    namedAccounts: campaign.targetingFilter?.namedAccounts ?? undefined,
    goal: campaign.salesGoal,
    limit,
  };

  // Pick a backend. Priority: explicit request → Apollo (if available) → web.
  // Sales Navigator honored only when explicitly requested and provisioned.
  const requested = opts.backend;
  let backend: DiscoveryBackendId;
  if (requested === "salesnav" && isSalesNavigatorAvailable()) backend = "salesnav";
  else if (requested === "apollo" && isApolloAvailable()) backend = "apollo";
  else if (requested === "web") backend = "web";
  else if (isApolloAvailable()) backend = "apollo"; // default to Apollo when key is set
  else backend = "web";

  let found: DiscoveryCandidate[] = [];
  let droppedCount = 0;
  let usage = { inputTokens: 0, outputTokens: 0 };
  let searchCount = 0;
  let model: string | null = null;
  let provider: string | null = null;

  if (backend === "salesnav") {
    try {
      found = await searchSalesNavigator(tenantDomain, input);
    } catch (err) {
      if (err instanceof SalesNavDiscoveryError) {
        // Fall back to Apollo or web rather than failing the request.
        backend = isApolloAvailable() ? "apollo" : "web";
      } else {
        throw err;
      }
    }
  }

  if (backend === "apollo") {
    try {
      found = await searchApollo(tenantDomain, input);
    } catch (err) {
      if (err instanceof ApolloDiscoveryError && err.code === "not_available") {
        backend = "web";
      } else {
        throw err;
      }
    }
  }

  if (backend === "web") {
    if (!isWebSearchAvailable()) {
      throw new Error(webDiscoveryReason());
    }
    const web = await searchWeb(tenantDomain, input);
    found = web.candidates;
    droppedCount = web.droppedCount;
    usage = web.usage;
    searchCount = web.searchCount;
    model = web.model;
    provider = web.provider;
  }

  const foundCount = found.length;

  // Dedup against prospects already on this campaign.
  const existing = await db
    .select({
      email: prospects.email,
      linkedinUrl: prospects.linkedinUrl,
      name: prospects.name,
      companyName: prospects.companyName,
    })
    .from(prospects)
    .where(eq(prospects.campaignId, campaign.id));

  const deduped = dedupeCandidates(found, existing);

  // Score each candidate; rank qualified-first, then by score.
  const scored: ScoredDiscoveryCandidate[] = deduped.map((candidate) => ({
    candidate,
    scored: scoreProspect(candidateToAttributes(candidate), criteria),
  }));
  scored.sort((a, b) => b.scored.score - a.scored.score);

  return { backend, candidates: scored, foundCount, droppedCount, usage, searchCount, model, provider };
}

/**
 * Import selected discovered candidates as `new` prospects on a campaign. The
 * geography/industry/segment/source facts ride in `signals` (where the scorer
 * and dossier already look), so research re-scores against the same evidence.
 */
export async function importDiscoveredProspects(
  tenantDomain: string,
  campaignId: string,
  candidates: DiscoveryCandidate[],
  ctx: { ownerUserId: string; marketId?: string | null },
): Promise<{ imported: Prospect[]; skipped: number }> {
  const [campaign] = await db
    .select()
    .from(outreachCampaigns)
    .where(eq(outreachCampaigns.id, campaignId));
  if (!campaign || campaign.tenantDomain !== tenantDomain) {
    throw new Error("Campaign not found");
  }

  // Re-dedup at import time against the live campaign (the preview may be stale).
  const existing = await db
    .select({
      email: prospects.email,
      linkedinUrl: prospects.linkedinUrl,
      name: prospects.name,
      companyName: prospects.companyName,
    })
    .from(prospects)
    .where(eq(prospects.campaignId, campaign.id));
  const toInsert = dedupeCandidates(candidates, existing);
  const skipped = candidates.length - toInsert.length;

  if (toInsert.length === 0) return { imported: [], skipped };

  const rows = toInsert.map((c) => ({
    campaignId: campaign.id,
    tenantDomain,
    marketId: ctx.marketId ?? null,
    name: c.name,
    title: c.title ?? null,
    companyName: c.companyName ?? null,
    email: c.email ?? null,
    linkedinUrl: c.linkedinUrl ?? null,
    source: c.source, // "web" | "salesnav"
    signals: {
      geography: c.geography ?? undefined,
      industry: c.industry ?? undefined,
      segment: c.segment ?? undefined,
      sources: c.sourceUrl ? [c.sourceUrl] : undefined,
    },
    ownerUserId: ctx.ownerUserId,
    status: "new" as const,
  }));

  const imported = await db.insert(prospects).values(rows).returning();
  return { imported, skipped };
}
