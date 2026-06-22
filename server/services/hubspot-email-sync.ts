/**
 * HubSpot marketing-email sync — service (Phase 1).
 *
 * Phase 1 surface is read-only: pull each candidate recipient's subscription
 * (consent) state from HubSpot so the send pipeline can suppress contacts who
 * opted out in HubSpot even when Orbit never recorded it. Writing engagement
 * to contact timelines and pushing unsubscribes back to HubSpot are later
 * phases.
 *
 * Standalone-safe: every entry point no-ops (returns an empty result) when the
 * tenant has no HubSpot connection or the connection predates the marketing-
 * email scopes. Sync failures never block or fail a send.
 *
 * The 2026-03 communication-preferences endpoints are not modeled by the
 * pinned @hubspot/api-client, so we call them over REST with the tenant's
 * refreshed access token.
 */

import { storage } from "../storage";
import {
  getTenantAccessToken,
  hasHubspotEmailScopes,
  HUBSPOT_REST_HOST,
} from "./hubspot-integration";
import { dedupeEmails, isOptedOutFromStatusPayload } from "./hubspot-email-sync-core";

// Cap how many per-contact status lookups we perform inline per send. The
// bulk status endpoint (Marketing Hub Enterprise) is a later optimization;
// until then, very large lists skip the pull and rely on local suppression +
// the unsubscribe webhook. Tunable via env.
const CONSENT_PULL_MAX = Number(process.env.MARKETING_HS_CONSENT_PULL_MAX || 1000);
const CONSENT_PULL_CONCURRENCY = Number(process.env.MARKETING_HS_CONSENT_CONCURRENCY || 5);

export interface ConsentPullResult {
  /** Normalized emails that HubSpot reports as opted out of marketing email. */
  optedOut: Set<string>;
  /** True when the pull actually ran (connected + scoped + within cap). */
  ran: boolean;
  /** Reason the pull was skipped, for diagnostics/audit. */
  skippedReason?: "not_connected" | "missing_scopes" | "too_large" | "error";
}

const EMPTY_SKIPPED = (reason: ConsentPullResult["skippedReason"]): ConsentPullResult => ({
  optedOut: new Set(),
  ran: false,
  skippedReason: reason,
});

/**
 * Returns the subset of `emails` that HubSpot reports as opted out of
 * marketing email. Best-effort: on any failure returns an empty opted-out set
 * (never throws), so the caller falls back to local suppression alone.
 */
export async function pullSubscriptionStatus(
  tenantDomain: string,
  emails: string[],
): Promise<ConsentPullResult> {
  const candidates = dedupeEmails(emails);
  if (candidates.length === 0) return { optedOut: new Set(), ran: true };

  const conn = await storage.getHubspotConnection(tenantDomain);
  if (!conn) return EMPTY_SKIPPED("not_connected");
  if (!hasHubspotEmailScopes(conn)) return EMPTY_SKIPPED("missing_scopes");
  if (candidates.length > CONSENT_PULL_MAX) return EMPTY_SKIPPED("too_large");

  let accessToken: string;
  try {
    ({ accessToken } = await getTenantAccessToken(tenantDomain));
  } catch {
    return EMPTY_SKIPPED("error");
  }

  const optedOut = new Set<string>();
  let hadError = false;

  // Bounded-concurrency worker over the candidate list.
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < candidates.length) {
      const email = candidates[cursor++];
      try {
        const optOut = await fetchOptedOut(accessToken, email);
        if (optOut) optedOut.add(email);
      } catch {
        hadError = true; // best-effort: skip this address, keep going
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(CONSENT_PULL_CONCURRENCY, candidates.length) }, worker),
  );

  return { optedOut, ran: true, skippedReason: hadError ? "error" : undefined };
}

/**
 * Fetch a single recipient's subscription status. A 404 (recipient unknown to
 * the preferences system) is treated as "not opted out".
 */
async function fetchOptedOut(accessToken: string, email: string): Promise<boolean> {
  const url = `${HUBSPOT_REST_HOST}/communication-preferences/v3/status/email/${encodeURIComponent(email)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  if (res.status === 404) return false;
  if (!res.ok) {
    throw new Error(`HubSpot subscription status ${res.status}`);
  }
  const payload = await res.json().catch(() => null);
  return isOptedOutFromStatusPayload(payload);
}
