/**
 * Platform Credentials Service
 *
 * Per-tenant OAuth client_id/client_secret storage. Each tenant brings their
 * own OAuth app (LinkedIn / Twitter / Facebook / Instagram); we no longer
 * read these from environment variables because tenant admins can't set
 * env vars on a multi-tenant deployment.
 *
 * Returns null when a tenant hasn't configured credentials for a platform —
 * publishers report `oauthConfigured(): false` in that case so the route
 * layer can show a clear "Configure credentials first" message.
 */

import { db } from "../db";
import { and, eq } from "drizzle-orm";
import {
  tenantPlatformCredentials,
  type PlatformCredentialPlatform,
  type TenantPlatformCredential,
} from "@shared/schema";
import { encryptSecret, decryptSecret } from "../utils/encryption";

export interface ResolvedPlatformCredentials {
  clientId: string;
  /** Optional — public OAuth clients (e.g., Twitter native apps) skip the secret. */
  clientSecret: string | null;
}

/**
 * Returns the single, Synozur-owned LinkedIn OAuth credentials from the
 * environment. LinkedIn is the one platform that uses a shared global app
 * (Buffer/Hootsuite pattern) rather than per-tenant credentials, so customers
 * can connect with one click without registering their own LinkedIn app.
 * Returns null when the global env vars are not set.
 */
export function getGlobalLinkedInCredentials(): ResolvedPlatformCredentials | null {
  const clientId = process.env.LINKEDIN_CLIENT_ID?.trim();
  const clientSecret = process.env.LINKEDIN_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

/**
 * Whether LinkedIn direct posting is live yet. The shared Synozur LinkedIn app
 * needs LinkedIn's Community Management API approval before its posting scopes
 * (w_member_social, w_organization_social, rw_organization_admin) will work, so
 * we keep direct posting gated OFF until that approval lands. Flip the
 * LINKEDIN_DIRECT_PUBLISH_ENABLED env var to "true" once the app is approved —
 * no code change needed.
 */
export function isLinkedInDirectPublishEnabled(): boolean {
  return process.env.LINKEDIN_DIRECT_PUBLISH_ENABLED?.trim().toLowerCase() === "true";
}

/**
 * Returns decrypted credentials for the (tenant, platform) pair, or null if
 * none configured. Decryption failures are treated as missing — callers
 * should surface that as "credentials need to be re-entered".
 *
 * LinkedIn is special-cased: it always resolves from the single Synozur-owned
 * global app (env vars), never from the per-tenant table.
 */
export async function getPlatformCredentials(
  tenantDomain: string,
  platform: PlatformCredentialPlatform | string,
): Promise<ResolvedPlatformCredentials | null> {
  if (platform === "linkedin") {
    return getGlobalLinkedInCredentials();
  }
  const [row] = await db.select().from(tenantPlatformCredentials).where(and(
    eq(tenantPlatformCredentials.tenantDomain, tenantDomain),
    eq(tenantPlatformCredentials.platform, platform),
  ));
  if (!row) return null;
  try {
    const clientId = decryptSecret(row.encryptedClientId);
    const clientSecret = row.encryptedClientSecret ? decryptSecret(row.encryptedClientSecret) : null;
    if (!clientId) return null;
    return { clientId, clientSecret };
  } catch (err) {
    console.warn(`[platform-credentials] decryption failed for ${tenantDomain}/${platform}`);
    return null;
  }
}

/**
 * Returns the row metadata (without secrets) for UI display. The UI shows
 * whether credentials are configured + a masked client_id; never the secret.
 */
export async function getPlatformCredentialMetadata(
  tenantDomain: string,
  platform: PlatformCredentialPlatform | string,
): Promise<{
  platform: string;
  isConfigured: boolean;
  hasSecret: boolean;
  clientIdPreview: string | null;
  notes: string | null;
  updatedAt: Date | null;
} | null> {
  const [row] = await db.select().from(tenantPlatformCredentials).where(and(
    eq(tenantPlatformCredentials.tenantDomain, tenantDomain),
    eq(tenantPlatformCredentials.platform, platform),
  ));
  if (!row) {
    return {
      platform,
      isConfigured: false,
      hasSecret: false,
      clientIdPreview: null,
      notes: null,
      updatedAt: null,
    };
  }
  let clientIdPreview: string | null = null;
  try {
    const clientId = decryptSecret(row.encryptedClientId);
    clientIdPreview = maskClientId(clientId);
  } catch {
    clientIdPreview = "(decrypt error)";
  }
  return {
    platform,
    isConfigured: true,
    hasSecret: !!row.encryptedClientSecret,
    clientIdPreview,
    notes: row.notes,
    updatedAt: row.updatedAt,
  };
}

export async function listPlatformCredentialMetadata(
  tenantDomain: string,
  platforms: readonly string[],
): Promise<Array<NonNullable<Awaited<ReturnType<typeof getPlatformCredentialMetadata>>>>> {
  // One round-trip; merge with the requested-platforms list so callers always
  // get a row per platform (configured or not).
  const rows = await db.select().from(tenantPlatformCredentials)
    .where(eq(tenantPlatformCredentials.tenantDomain, tenantDomain));
  const byPlatform = new Map<string, TenantPlatformCredential>();
  rows.forEach(r => byPlatform.set(r.platform, r));
  return platforms.map(platform => {
    const row = byPlatform.get(platform);
    if (!row) {
      return {
        platform,
        isConfigured: false,
        hasSecret: false,
        clientIdPreview: null,
        notes: null,
        updatedAt: null,
      };
    }
    let clientIdPreview: string | null = null;
    try {
      const clientId = decryptSecret(row.encryptedClientId);
      clientIdPreview = maskClientId(clientId);
    } catch {
      clientIdPreview = "(decrypt error)";
    }
    return {
      platform,
      isConfigured: true,
      hasSecret: !!row.encryptedClientSecret,
      clientIdPreview,
      notes: row.notes,
      updatedAt: row.updatedAt,
    };
  });
}

export async function upsertPlatformCredentials(input: {
  tenantDomain: string;
  platform: PlatformCredentialPlatform | string;
  clientId: string;
  clientSecret?: string | null;
  notes?: string | null;
  userId: string;
}): Promise<void> {
  const clientId = input.clientId.trim();
  if (!clientId) throw new Error("clientId is required");
  const encryptedClientId = encryptSecret(clientId);
  const encryptedClientSecret = input.clientSecret && input.clientSecret.trim()
    ? encryptSecret(input.clientSecret.trim())
    : null;

  const [existing] = await db.select({ id: tenantPlatformCredentials.id })
    .from(tenantPlatformCredentials)
    .where(and(
      eq(tenantPlatformCredentials.tenantDomain, input.tenantDomain),
      eq(tenantPlatformCredentials.platform, input.platform),
    ));

  if (existing) {
    await db.update(tenantPlatformCredentials).set({
      encryptedClientId,
      // Don't wipe an existing secret if the caller passed undefined — only
      // overwrite when an explicit empty string or new value comes in.
      // null = explicit clear; undefined = leave as-is.
      ...(input.clientSecret !== undefined ? { encryptedClientSecret } : {}),
      notes: input.notes ?? null,
      updatedAt: new Date(),
    }).where(eq(tenantPlatformCredentials.id, existing.id));
  } else {
    await db.insert(tenantPlatformCredentials).values({
      tenantDomain: input.tenantDomain,
      platform: input.platform,
      encryptedClientId,
      encryptedClientSecret,
      notes: input.notes ?? null,
      createdBy: input.userId,
    });
  }
}

export async function deletePlatformCredentials(
  tenantDomain: string,
  platform: PlatformCredentialPlatform | string,
): Promise<void> {
  await db.delete(tenantPlatformCredentials).where(and(
    eq(tenantPlatformCredentials.tenantDomain, tenantDomain),
    eq(tenantPlatformCredentials.platform, platform),
  ));
}

function maskClientId(s: string): string {
  if (s.length <= 6) return "•".repeat(s.length);
  return `${s.slice(0, 4)}…${s.slice(-2)}`;
}
