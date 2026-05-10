/**
 * Platform Credentials Service
 *
 * Per-tenant OAuth client_id/client_secret storage for platforms where
 * tenants must bring their own OAuth app (Twitter / Facebook / Instagram).
 *
 * LinkedIn is the exception: it uses a single Synozur-owned Developer App
 * shared across all tenants (the standard SaaS model — Buffer, Hootsuite,
 * etc. work the same way). LinkedIn credentials come from the
 * LINKEDIN_CLIENT_ID / LINKEDIN_CLIENT_SECRET env vars and are never
 * exposed to tenant admins.
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
 * Returns decrypted credentials for the (tenant, platform) pair, or null if
 * none configured. Decryption failures are treated as missing — callers
 * should surface that as "credentials need to be re-entered".
 *
 * For LinkedIn, the lookup is tenant-independent: a single Synozur-owned app
 * is read from env vars and returned for every tenant. Per-tenant DB rows
 * for `linkedin` are never read.
 */
export async function getPlatformCredentials(
  tenantDomain: string,
  platform: PlatformCredentialPlatform | string,
): Promise<ResolvedPlatformCredentials | null> {
  if (platform === "linkedin") {
    const clientId = process.env.LINKEDIN_CLIENT_ID?.trim();
    const clientSecret = process.env.LINKEDIN_CLIENT_SECRET?.trim();
    if (!clientId || !clientSecret) return null;
    return { clientId, clientSecret };
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
