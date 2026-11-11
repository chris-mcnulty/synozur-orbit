import { db } from "../db";
import { rateLimitBuckets } from "@shared/schema";
import type { ApolloRevealOutcome } from "@shared/apollo-reveal";
import { isApolloAvailable, revealApolloPersonById } from "./apollo-discovery-provider";
import { loadCampaignContext, type ScoredDiscoveryCandidate } from "./discovery-service";
import { candidateToAttributes, matchesDiscoveryCompany, type DiscoveryCandidate } from "./discovery-provider-core";
import { scoreProspectAgainstAll } from "./prospector-core";
import { apolloRevealClaimKey, ApolloRevealError, type ApolloRevealScope, type VerifiedApolloPreview } from "./apollo-reveal-core";

/** Verify current employer against both the search preview and explicit filter. */
export function scopedRevealedCandidate(candidate: DiscoveryCandidate, verified: VerifiedApolloPreview): DiscoveryCandidate | null {
  const expected = verified.preview;
  if (!expected.companyName || !matchesDiscoveryCompany(candidate, expected.companyName)) return null;
  if (candidate.companyDomain && expected.companyDomain && !matchesDiscoveryCompany(candidate, expected.companyDomain)) return null;
  const result = { ...candidate, companyDomain: candidate.companyDomain ?? expected.companyDomain };
  return verified.company && !matchesDiscoveryCompany(result, verified.company) ? null : result;
}

export async function revealApolloPreviews(
  scope: ApolloRevealScope, tokens: string[], previews: VerifiedApolloPreview[],
) {
  if (!isApolloAvailable()) throw new ApolloRevealError("Apollo is not available.", 503);
  const { campaign, campaignPersonas } = await loadCampaignContext(scope.tenantDomain, scope.campaignId);
  const candidates: ScoredDiscoveryCandidate[] = [];
  const outcomes: ApolloRevealOutcome[] = [];
  const attemptedIds: string[] = [];
  // Two workers bound runtime without an unbounded provider burst; no retries.
  let nextIndex = 0;
  await Promise.all(Array.from({ length: Math.min(2, previews.length) }, async () => {
    while (nextIndex < previews.length) {
      const index = nextIndex++;
      const preview = previews[index];
      const previewId = preview.preview.id;
      try {
        // Reuse the existing persistent bucket store as an atomic one-use gate.
        // Fail closed on DB errors. Never delete a claim after timeout/failure.
        const claimed = await db.insert(rateLimitBuckets).values({
          tenantDomain: scope.tenantDomain, scope: "apollo-reveal-once",
          key: apolloRevealClaimKey(tokens[index]), count: 1,
          resetAt: new Date(preview.expiresAt),
        }).onConflictDoNothing().returning({ key: rateLimitBuckets.key });
        if (!claimed.length) {
          outcomes.push({ previewId, status: "already_attempted", message: "This preview was already attempted. No second Apollo request was made; a prior result may be unconfirmed." });
          continue;
        }
        // Check expiration again after persistence, before spending credits.
        if (preview.expiresAt <= Date.now()) {
          outcomes.push({ previewId, status: "unavailable", message: "Preview expired before reveal. No Apollo request was made." });
          continue;
        }
        attemptedIds.push(previewId);
        const person = await revealApolloPersonById(previewId);
        if (!person) {
          outcomes.push({ previewId, status: "unavailable", message: "Apollo did not return a complete matching identity. Credits may still have been used." });
          continue;
        }
        const scoped = scopedRevealedCandidate(person, preview);
        if (!scoped) {
          outcomes.push({ previewId, status: "out_of_scope", message: "Current employer no longer matches the reviewed company. Contact withheld; credits may still have been used." });
          continue;
        }
        candidates.push({
          candidate: scoped,
          scored: scoreProspectAgainstAll(campaignPersonas, campaign.targetingFilter ?? undefined, candidateToAttributes(scoped)),
        });
        outcomes.push({ previewId, status: "revealed", message: "Identity revealed. Review and import separately; nothing was sent." });
      } catch {
        outcomes.push({
          previewId, status: "failed",
          message: attemptedIds.includes(previewId)
            ? "Reveal could not be confirmed. Credits may have been used; no automatic retry was made."
            : "Reveal could not be reserved safely. No Apollo request was made.",
        });
      }
    }
  }));
  return { candidates, outcomes, attemptedCount: attemptedIds.length, attemptedIds };
}
