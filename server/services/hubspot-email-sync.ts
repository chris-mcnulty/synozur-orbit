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
import { dedupeEmails, isOptedOutFromStatusPayload, normalizeEmail } from "./hubspot-email-sync-core";
import { checkFeatureAccessAsync } from "./plan-policy";

/**
 * Whether the marketing-email sync feature is enabled for this tenant's plan.
 * Gates every HubSpot sync side-effect so a downgrade or a manual feature
 * override (hubspotEmailSync = false) disables sync even while a HubSpot
 * connection still exists. Fails closed (disabled) on error.
 */
export async function isHubspotEmailSyncEnabled(tenantDomain: string): Promise<boolean> {
  try {
    const tenant = await storage.getTenantByDomain(tenantDomain);
    const gate = await checkFeatureAccessAsync(tenant?.plan || "free", "hubspotEmailSync");
    return gate.allowed;
  } catch {
    return false;
  }
}

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
  skippedReason?: "disabled" | "not_connected" | "missing_scopes" | "too_large" | "error";
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

  if (!(await isHubspotEmailSyncEnabled(tenantDomain))) return EMPTY_SKIPPED("disabled");
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

export type ConsentWriteResult = "ok" | "skipped" | "blocked" | "error";

/**
 * Resolve the HubSpot subscription id this tenant uses for marketing email:
 * the per-connection default, or a portal-agnostic env fallback.
 */
function resolveSubscriptionId(conn: { defaultSubscriptionId?: string | null }): string | undefined {
  const id = conn.defaultSubscriptionId || process.env.HUBSPOT_DEFAULT_SUBSCRIPTION_ID;
  return id && String(id).trim() ? String(id).trim() : undefined;
}

/**
 * Push an unsubscribe (opt-out) for `email` back to HubSpot's communication
 * preferences. Best-effort, never throws.
 *
 * - "skipped": not connected / missing scopes / no subscription id configured
 *   (local suppression already blocks the send; the pre-send consent pull
 *   keeps HubSpot authoritative once a subscription id is set).
 * - "blocked": HubSpot refused (e.g. the contact already opted out via an
 *   email link and can't be programmatically changed) — treated as success
 *   for our purposes (they're already opted out).
 */
export async function pushUnsubscribe(tenantDomain: string, email: string): Promise<ConsentWriteResult> {
  try {
    if (!(await isHubspotEmailSyncEnabled(tenantDomain))) return "skipped";
    const conn = await storage.getHubspotConnection(tenantDomain);
    if (!conn || !hasHubspotEmailScopes(conn)) return "skipped";
    const subscriptionId = resolveSubscriptionId(conn);
    if (!subscriptionId) return "skipped";

    const { accessToken } = await getTenantAccessToken(tenantDomain);
    const res = await fetch(`${HUBSPOT_REST_HOST}/communication-preferences/v3/unsubscribe`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ emailAddress: normalizeEmail(email), subscriptionId }),
    });
    if (res.ok) return "ok";
    // 400/409 commonly mean "already unsubscribed / can't be changed" — the
    // contact is opted out either way, so this is not a real failure.
    if (res.status === 400 || res.status === 409) return "blocked";
    return "error";
  } catch {
    return "error";
  }
}

/**
 * Push a (re)subscribe for `email` to HubSpot. Used by the preference center
 * when a recipient opts back in themselves. Best-effort; HubSpot blocks
 * programmatic re-subscribe for contacts who opted out via an email link, in
 * which case this returns "blocked" and the next pre-send consent pull will
 * keep them suppressed — HubSpot stays authoritative.
 */
export async function pushSubscribe(tenantDomain: string, email: string): Promise<ConsentWriteResult> {
  try {
    if (!(await isHubspotEmailSyncEnabled(tenantDomain))) return "skipped";
    const conn = await storage.getHubspotConnection(tenantDomain);
    if (!conn || !hasHubspotEmailScopes(conn)) return "skipped";
    const subscriptionId = resolveSubscriptionId(conn);
    if (!subscriptionId) return "skipped";

    const { accessToken } = await getTenantAccessToken(tenantDomain);
    const res = await fetch(`${HUBSPOT_REST_HOST}/communication-preferences/v3/subscribe`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        emailAddress: normalizeEmail(email),
        subscriptionId,
        legalBasis: "CONSENT_WITH_NOTICE",
        legalBasisExplanation: "Contact resubscribed via the email preference center.",
      }),
    });
    if (res.ok) return "ok";
    if (res.status === 400 || res.status === 409) return "blocked";
    return "error";
  } catch {
    return "error";
  }
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
