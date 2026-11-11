import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { APOLLO_PREVIEW_TTL_MS, MAX_APOLLO_REVEAL_BATCH, type ApolloSearchPreview, type ApolloRevealPreview } from "@shared/apollo-reveal";

export interface ApolloRevealScope { tenantDomain: string; campaignId: string; userId: string }
export class ApolloRevealError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
const payloadSchema = z.object({
  v: z.literal(1), tenantDomain: z.string(), campaignId: z.string(), userId: z.string(),
  company: z.string().max(200).nullable(), expiresAt: z.number().int(),
  preview: z.object({
    id: z.string().min(1).max(200), displayName: z.string().max(400),
    title: z.string().max(1000).nullable(), companyName: z.string().max(500).nullable(),
    companyDomain: z.string().max(500).nullable(),
  }).strict(),
}).strict();
export type VerifiedApolloPreview = z.infer<typeof payloadSchema>;

function signature(body: string, secret: string) {
  return createHmac("sha256", secret).update(`orbit-apollo-reveal:v1:${body}`).digest();
}
export function signApolloPreviews(
  previews: ApolloSearchPreview[], scope: ApolloRevealScope, company: string | undefined,
  secret: string, now = Date.now(),
): ApolloRevealPreview[] {
  if (!secret) throw new ApolloRevealError("Apollo preview authorization is unavailable.", 503);
  const expiresAt = now + APOLLO_PREVIEW_TTL_MS;
  return Array.from(new Map(previews.map(p => [p.id, p])).values()).slice(0, 100).map(preview => {
    const payload = payloadSchema.parse({ v: 1, ...scope, company: company ?? null, expiresAt, preview });
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
    return { ...preview, token: `${body}.${signature(body, secret).toString("base64url")}`, expiresAt: new Date(expiresAt).toISOString() };
  });
}
export function verifyApolloPreviews(tokens: string[], scope: ApolloRevealScope, secret: string, now = Date.now()): VerifiedApolloPreview[] {
  if (!secret) throw new ApolloRevealError("Apollo preview authorization is unavailable.", 503);
  if (!tokens.length || tokens.length > MAX_APOLLO_REVEAL_BATCH) throw new ApolloRevealError(`Select between 1 and ${MAX_APOLLO_REVEAL_BATCH} previews.`);
  const previews = tokens.map(token => {
    if (typeof token !== "string" || token.length > 8192) throw new ApolloRevealError("Invalid Apollo preview.");
    const parts = token.split(".");
    if (parts.length !== 2) throw new ApolloRevealError("Invalid Apollo preview.");
    const expected = signature(parts[0], secret);
    const actual = Buffer.from(parts[1], "base64url");
    if (actual.toString("base64url") !== parts[1] || actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new ApolloRevealError("Apollo preview was modified. Run discovery again.");
    let decoded: unknown;
    try { decoded = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")); }
    catch { throw new ApolloRevealError("Invalid Apollo preview."); }
    const parsed = payloadSchema.safeParse(decoded);
    if (!parsed.success) throw new ApolloRevealError("Invalid Apollo preview.");
    const p = parsed.data;
    if (p.tenantDomain !== scope.tenantDomain || p.campaignId !== scope.campaignId || p.userId !== scope.userId) {
      throw new ApolloRevealError("Apollo preview does not belong to this user and campaign.", 403);
    }
    if (p.expiresAt <= now || p.expiresAt > now + APOLLO_PREVIEW_TTL_MS) throw new ApolloRevealError("Apollo preview expired. Run discovery again.", 410);
    return p;
  });
  if (new Set(previews.map(p => p.preview.id)).size !== previews.length) throw new ApolloRevealError("Select each preview only once.");
  if (new Set(previews.map(p => p.company)).size !== 1) throw new ApolloRevealError("Use previews from the same company search.");
  return previews;
}
/** A persistent, single-use key; requests cannot be recharged after a lost response. */
export function apolloRevealClaimKey(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
