/**
 * HubSpot marketing-email sync — pure core (Phase 1).
 *
 * Side-effect-free helpers shared by the contact resolver and the consent
 * pull. Kept separate from the HubSpot-calling services so the decision logic
 * (email normalization, consent reconciliation, sync-status mapping) is unit
 * testable without network or DB.
 */

/** Lowercase + trim an email for use as a stable join key. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Normalize + de-duplicate a list of emails, preserving first-seen order. */
export function dedupeEmails(emails: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of emails) {
    const e = normalizeEmail(raw);
    if (!e || seen.has(e)) continue;
    seen.add(e);
    out.push(e);
  }
  return out;
}

export type ContactResolutionOutcome = "found" | "created" | "not_found" | "error";

/** Persisted hs_sync_status for a recipient given a resolution outcome. */
export function syncStatusForOutcome(outcome: ContactResolutionOutcome): "resolved" | "skipped" | "error" {
  switch (outcome) {
    case "found":
    case "created":
      return "resolved";
    case "not_found":
      return "skipped";
    case "error":
      return "error";
  }
}

/**
 * Decide whether a contact is opted out of marketing email from a HubSpot
 * communication-preferences status payload (2026-03 API shape):
 *
 *   { recipient, subscriptionStatuses: [{ id, name, status, ... }] }
 *
 * where `status` is one of SUBSCRIBED | NOT_SUBSCRIBED | UNSUBSCRIBED.
 *
 * Conservative rule to avoid over-suppression: treat as opted out only when
 * the payload shows an explicit UNSUBSCRIBED status AND no SUBSCRIBED status
 * remains. A missing/empty payload (e.g. contact not found, or never set a
 * preference) is treated as NOT opted out — local suppression still applies.
 */
export function isOptedOutFromStatusPayload(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return false;
  const statuses = (payload as { subscriptionStatuses?: unknown }).subscriptionStatuses;
  if (!Array.isArray(statuses) || statuses.length === 0) return false;
  let hasSubscribed = false;
  let hasUnsubscribed = false;
  for (const s of statuses) {
    const status = String((s as { status?: unknown })?.status ?? "").toUpperCase();
    if (status === "SUBSCRIBED") hasSubscribed = true;
    if (status === "UNSUBSCRIBED") hasUnsubscribed = true;
  }
  return hasUnsubscribed && !hasSubscribed;
}

export type SuppressionReason = string;

/**
 * Reconcile Orbit's local suppression with HubSpot's opt-out state for a set
 * of candidate recipients. The result is the union of both: a contact that is
 * suppressed locally OR opted out in HubSpot is excluded.
 *
 * Consent rule (locked decision): **HubSpot is authoritative for opt-out** —
 * an opt-out in HubSpot always suppresses, even if Orbit never recorded it.
 * We never do the inverse (HubSpot "subscribed" does not clear a local
 * suppression), so this is a strict union and never re-enables sending.
 *
 * Local reasons are preserved; HubSpot-only opt-outs are labeled
 * `hubspot_optout`.
 *
 * @returns email → reason for every suppressed candidate.
 */
export function reconcileSuppression(opts: {
  candidateEmails: string[];
  locallySuppressed: Map<string, SuppressionReason>;
  hubspotOptedOut: Set<string>;
}): Map<string, SuppressionReason> {
  const { candidateEmails, locallySuppressed, hubspotOptedOut } = opts;
  const result = new Map<string, SuppressionReason>();
  for (const raw of candidateEmails) {
    const email = normalizeEmail(raw);
    if (!email) continue;
    const localReason = locallySuppressed.get(email);
    if (localReason) {
      result.set(email, localReason);
    } else if (hubspotOptedOut.has(email)) {
      result.set(email, "hubspot_optout");
    }
  }
  return result;
}
