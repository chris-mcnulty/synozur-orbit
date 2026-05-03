import crypto from "crypto";
import { db } from "../db";
import {
  oauthClients,
  oauthAuthorizationCodes,
  oauthAccessTokens,
  oauthRefreshTokens,
  oauthApiAudit,
  PARTNER_API_SCOPES,
  type PartnerApiScope,
} from "@shared/schema";
import { eq, and, desc, isNull } from "drizzle-orm";

const ACCESS_TOKEN_TTL_SECONDS = 3600; // 1 hour
const REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days
const AUTH_CODE_TTL_SECONDS = 600; // 10 minutes

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function generateOpaqueToken(byteLength = 32): string {
  return crypto.randomBytes(byteLength).toString("base64url");
}

export function verifyPkceS256(verifier: string, challenge: string): boolean {
  const computed = crypto
    .createHash("sha256")
    .update(verifier)
    .digest("base64url");
  // constant-time compare
  if (computed.length !== challenge.length) return false;
  return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(challenge));
}

export function isValidScope(s: string): s is PartnerApiScope {
  return (PARTNER_API_SCOPES as readonly string[]).includes(s);
}

export function parseScopeString(s: string | undefined | null): string[] {
  if (!s) return [];
  return s.split(/\s+/).filter(Boolean);
}

export function intersectScopes(requested: string[], allowed: string[]): string[] {
  const set = new Set(allowed);
  return requested.filter((s) => set.has(s));
}

export async function getClientById(clientId: string) {
  const [row] = await db.select().from(oauthClients).where(eq(oauthClients.id, clientId));
  return row;
}

export async function createAuthorizationCode(params: {
  clientId: string;
  userId: string;
  tenantDomain: string;
  marketId: string | null;
  redirectUri: string;
  scopes: string[];
  codeChallenge: string;
  codeChallengeMethod: string;
}) {
  const code = generateOpaqueToken(32);
  const expiresAt = new Date(Date.now() + AUTH_CODE_TTL_SECONDS * 1000);
  await db.insert(oauthAuthorizationCodes).values({
    codeHash: hashToken(code),
    clientId: params.clientId,
    userId: params.userId,
    tenantDomain: params.tenantDomain,
    marketId: params.marketId,
    redirectUri: params.redirectUri,
    scopes: params.scopes,
    codeChallenge: params.codeChallenge,
    codeChallengeMethod: params.codeChallengeMethod || "S256",
    expiresAt,
  });
  return { code, expiresAt };
}

/**
 * Look up an authorization code without marking it used. The caller MUST
 * validate client_id / redirect_uri / PKCE before calling
 * `markAuthorizationCodeUsed` to flip the `used` flag.
 */
export async function lookupAuthorizationCode(code: string) {
  const codeHash = hashToken(code);
  const [row] = await db.select().from(oauthAuthorizationCodes).where(eq(oauthAuthorizationCodes.codeHash, codeHash));
  if (!row) return { error: "invalid_grant", message: "Authorization code not found" } as const;
  if (row.used) {
    return { error: "invalid_grant", message: "Authorization code already used" } as const;
  }
  if (new Date(row.expiresAt).getTime() <= Date.now()) {
    return { error: "invalid_grant", message: "Authorization code expired" } as const;
  }
  return { row } as const;
}

/** Atomically mark a code used. Returns true only if it transitioned. */
export async function markAuthorizationCodeUsed(id: string): Promise<boolean> {
  const result = await db
    .update(oauthAuthorizationCodes)
    .set({ used: true })
    .where(and(eq(oauthAuthorizationCodes.id, id), eq(oauthAuthorizationCodes.used, false)))
    .returning({ id: oauthAuthorizationCodes.id });
  return result.length > 0;
}

export interface IssuedTokenPair {
  accessToken: string;
  accessTokenId: string;
  refreshToken: string;
  refreshTokenId: string;
  expiresIn: number;
  refreshExpiresIn: number;
  scopes: string[];
}

export async function issueTokenPair(params: {
  clientId: string;
  userId: string;
  tenantDomain: string;
  marketId: string | null;
  scopes: string[];
}): Promise<IssuedTokenPair> {
  const accessToken = generateOpaqueToken(32);
  const refreshToken = generateOpaqueToken(32);
  const accessExpiresAt = new Date(Date.now() + ACCESS_TOKEN_TTL_SECONDS * 1000);
  const refreshExpiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000);

  const [accessRow] = await db
    .insert(oauthAccessTokens)
    .values({
      tokenHash: hashToken(accessToken),
      clientId: params.clientId,
      userId: params.userId,
      tenantDomain: params.tenantDomain,
      marketId: params.marketId,
      scopes: params.scopes,
      expiresAt: accessExpiresAt,
    })
    .returning();

  const [refreshRow] = await db
    .insert(oauthRefreshTokens)
    .values({
      tokenHash: hashToken(refreshToken),
      accessTokenId: accessRow.id,
      clientId: params.clientId,
      userId: params.userId,
      tenantDomain: params.tenantDomain,
      marketId: params.marketId,
      scopes: params.scopes,
      expiresAt: refreshExpiresAt,
    })
    .returning();

  return {
    accessToken,
    accessTokenId: accessRow.id,
    refreshToken,
    refreshTokenId: refreshRow.id,
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    refreshExpiresIn: REFRESH_TOKEN_TTL_SECONDS,
    scopes: params.scopes,
  };
}

export async function rotateRefreshToken(refreshToken: string, clientId: string) {
  const tokenHash = hashToken(refreshToken);
  const [row] = await db.select().from(oauthRefreshTokens).where(eq(oauthRefreshTokens.tokenHash, tokenHash));
  if (!row) return { error: "invalid_grant", message: "Refresh token not found" } as const;
  if (row.clientId !== clientId) {
    return { error: "invalid_grant", message: "Client mismatch" } as const;
  }
  if (row.revokedAt) {
    return { error: "invalid_grant", message: "Refresh token revoked" } as const;
  }
  if (new Date(row.expiresAt).getTime() <= Date.now()) {
    return { error: "invalid_grant", message: "Refresh token expired" } as const;
  }

  // Atomic single-use revoke: only the first concurrent caller wins. If
  // another request already consumed this refresh token, the WHERE clause
  // matches zero rows and we reject the racing request.
  const claim = await db
    .update(oauthRefreshTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(oauthRefreshTokens.id, row.id), isNull(oauthRefreshTokens.revokedAt)))
    .returning({ id: oauthRefreshTokens.id });
  if (claim.length === 0) {
    return { error: "invalid_grant", message: "Refresh token already used" } as const;
  }
  if (row.accessTokenId) {
    await db.update(oauthAccessTokens).set({ revokedAt: new Date() }).where(eq(oauthAccessTokens.id, row.accessTokenId));
  }

  const pair = await issueTokenPair({
    clientId: row.clientId,
    userId: row.userId,
    tenantDomain: row.tenantDomain,
    marketId: row.marketId ?? null,
    scopes: row.scopes || [],
  });

  await db
    .update(oauthRefreshTokens)
    .set({ rotatedToId: pair.refreshTokenId })
    .where(eq(oauthRefreshTokens.id, row.id));

  return { pair } as const;
}

export async function revokeToken(token: string) {
  const tokenHash = hashToken(token);
  // Try access first
  const [a] = await db.select().from(oauthAccessTokens).where(eq(oauthAccessTokens.tokenHash, tokenHash));
  if (a) {
    if (!a.revokedAt) {
      await db.update(oauthAccessTokens).set({ revokedAt: new Date() }).where(eq(oauthAccessTokens.id, a.id));
    }
    // Cascade: revoke any refresh token bound to this access token so the
    // full grant is invalidated by a single /oauth/revoke call (RFC 7009).
    await db
      .update(oauthRefreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(oauthRefreshTokens.accessTokenId, a.id), isNull(oauthRefreshTokens.revokedAt)));
    return true;
  }
  const [r] = await db.select().from(oauthRefreshTokens).where(eq(oauthRefreshTokens.tokenHash, tokenHash));
  if (r) {
    if (!r.revokedAt) {
      await db.update(oauthRefreshTokens).set({ revokedAt: new Date() }).where(eq(oauthRefreshTokens.id, r.id));
    }
    if (r.accessTokenId) {
      await db
        .update(oauthAccessTokens)
        .set({ revokedAt: new Date() })
        .where(eq(oauthAccessTokens.id, r.accessTokenId));
    }
    return true;
  }
  return false;
}

export async function revokeAccessTokenById(accessTokenId: string) {
  await db.update(oauthAccessTokens).set({ revokedAt: new Date() }).where(eq(oauthAccessTokens.id, accessTokenId));
  await db
    .update(oauthRefreshTokens)
    .set({ revokedAt: new Date() })
    .where(eq(oauthRefreshTokens.accessTokenId, accessTokenId));
}

export async function listClientTokens(clientId: string) {
  const access = await db
    .select()
    .from(oauthAccessTokens)
    .where(eq(oauthAccessTokens.clientId, clientId))
    .orderBy(desc(oauthAccessTokens.createdAt));
  return access;
}

export async function listTokensForTenant(tenantDomain: string) {
  const access = await db
    .select()
    .from(oauthAccessTokens)
    .where(eq(oauthAccessTokens.tenantDomain, tenantDomain))
    .orderBy(desc(oauthAccessTokens.createdAt));
  return access;
}

export async function logApiAccess(entry: {
  tokenId?: string;
  clientId?: string;
  userId?: string;
  tenantDomain?: string;
  route: string;
  method: string;
  status: number;
  scope?: string;
}) {
  try {
    await db.insert(oauthApiAudit).values(entry);
  } catch (err) {
    console.error("[OAuth] Failed to write audit row:", err);
  }
}

export async function listApiAudit(tenantDomain: string, limit = 200) {
  return await db
    .select()
    .from(oauthApiAudit)
    .where(eq(oauthApiAudit.tenantDomain, tenantDomain))
    .orderBy(desc(oauthApiAudit.createdAt))
    .limit(limit);
}

// ─── Per-token sliding-window rate limiter (in-memory, v1) ─────────────────
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 120; // 120 requests / min / token
const rateBuckets = new Map<string, number[]>();

export function checkRateLimit(tokenId: string): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const cutoff = now - RATE_LIMIT_WINDOW_MS;
  const arr = (rateBuckets.get(tokenId) || []).filter((t) => t > cutoff);
  if (arr.length >= RATE_LIMIT_MAX) {
    return { allowed: false, remaining: 0, resetAt: arr[0] + RATE_LIMIT_WINDOW_MS };
  }
  arr.push(now);
  rateBuckets.set(tokenId, arr);
  return { allowed: true, remaining: RATE_LIMIT_MAX - arr.length, resetAt: now + RATE_LIMIT_WINDOW_MS };
}

export function generateClientSecret() {
  return generateOpaqueToken(32);
}

export function hashClientSecret(secret: string) {
  return crypto.createHash("sha256").update(secret).digest("hex");
}
