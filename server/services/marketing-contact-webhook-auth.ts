/**
 * Marketing Contact Webhook Authentication
 *
 * Extracted as a standalone module so the HMAC logic can be unit-tested
 * without importing Express route handlers.
 *
 * Signature scheme:
 *   signedPayload = tenantDomain + ":" + rawBodyBytes
 *   signature     = Base64( HMAC-SHA256( signedPayload, WEBBASE_WEBHOOK_SECRET ) )
 *
 * Embedding tenantDomain in the signed payload means a signature valid for
 * tenant A cannot be replayed against tenant B — the HMAC inputs differ.
 */

import { createHmac, timingSafeEqual } from "crypto";

/**
 * Compute the expected signature for a given tenant + body.
 * Webbase should call this before sending each ingest-event request.
 */
export function computeWebhookSignature(
  tenantDomain: string,
  rawBody: Buffer | string,
  secret: string,
): string {
  const body = typeof rawBody === "string" ? Buffer.from(rawBody, "utf8") : rawBody;
  const signingPayload = Buffer.concat([Buffer.from(tenantDomain + ":", "utf8"), body]);
  return createHmac("sha256", secret).update(signingPayload).digest("base64");
}

/**
 * Verify the X-Orbit-Signature header against the expected HMAC for this
 * tenant. Returns true only when both the secret is configured AND the
 * signature matches.
 *
 * Fails closed in every environment:
 *   - Missing secret  → always reject (misconfiguration must not become open access)
 *   - Missing header  → always reject
 *   - Wrong signature → always reject
 *
 * For local development, set WEBBASE_WEBHOOK_SECRET to any non-empty string
 * and compute signatures with computeWebhookSignature().
 */
export function verifyWebhookSignature(
  tenantDomain: string,
  rawBody: Buffer | string,
  signatureHeader: string | undefined,
): boolean {
  const secret = process.env.WEBBASE_WEBHOOK_SECRET;
  if (!secret) {
    // No secret configured → reject unconditionally in every environment.
    // This prevents a misconfigured deployment from silently accepting all requests.
    console.warn("[marketing-contacts] WEBBASE_WEBHOOK_SECRET not set — rejecting webhook (set this env var to enable the ingest endpoint)");
    return false;
  }
  if (!signatureHeader) return false;
  const expected = computeWebhookSignature(tenantDomain, rawBody, secret);
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader));
  } catch {
    return false;
  }
}
