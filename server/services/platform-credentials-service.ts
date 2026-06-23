/**
 * Platform Credentials Service
 *
 * Social platforms use ONE Synozur-owned OAuth app each (the Buffer/Hootsuite
 * model): customers connect one-click and never register their own app. There
 * is no per-tenant OAuth app and we do not read these from env vars (LinkedIn
 * aside — see below). The shared app credentials live encrypted in the
 * `global_platform_credentials` table and are managed by a Global Admin in the
 * UI (Admin → Platform Credentials).
 *
 *   - twitter  → its own global row
 *   - facebook → its own global row; ALSO powers Instagram (the Instagram
 *                publisher asks for "facebook" credentials)
 *   - linkedin → still resolves from the original shared Synozur app env vars
 *                (LINKEDIN_CLIENT_ID / LINKEDIN_CLIENT_SECRET) and its own gate;
 *                that flow already shipped and is left untouched here.
 *
 * `getPlatformCredentials()` returns null when the shared app for a platform
 * isn't configured yet — publishers report `oauthConfigured(): false` so the
 * route layer can show "not available yet — contact Synozur".
 */

import { db } from "../db";
import { eq } from "drizzle-orm";
import {
  globalPlatformCredentials,
  type GlobalCredentialPlatform,
} from "@shared/schema";
import { encryptSecret, decryptSecret } from "../utils/encryption";

export interface ResolvedPlatformCredentials {
  clientId: string;
  /** Optional — public OAuth clients (e.g., Twitter native apps) skip the secret. */
  clientSecret: string | null;
}

/**
 * Returns the single, Synozur-owned LinkedIn OAuth credentials from the
 * environment. LinkedIn shipped first on the shared-app model via env vars and
 * is intentionally left on that path. Returns null when the env vars are unset.
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
 * will work, so direct posting stays gated OFF until the
 * LINKEDIN_DIRECT_PUBLISH_ENABLED env var is "true".
 */
export function isLinkedInDirectPublishEnabled(): boolean {
  return process.env.LINKEDIN_DIRECT_PUBLISH_ENABLED?.trim().toLowerCase() === "true";
}

/**
 * Resolves the platform a publisher asks for to the global row that actually
 * holds its credentials. Instagram rides on the Facebook/Meta app, so it never
 * has its own row — callers pass "facebook" for it, but we normalise defensively.
 */
function resolveGlobalRowPlatform(platform: string): GlobalCredentialPlatform | null {
  const p = platform.toLowerCase();
  if (p === "twitter") return "twitter";
  if (p === "facebook" || p === "instagram") return "facebook";
  return null;
}

/**
 * Returns decrypted credentials for a platform's shared Synozur app, or null if
 * none configured. Decryption failures are treated as missing.
 *
 * The `tenantDomain` argument is retained for signature compatibility with the
 * publisher interface but is no longer used — these apps are platform-wide, not
 * per-tenant. LinkedIn resolves from env vars; everything else from the global
 * table.
 */
export async function getPlatformCredentials(
  _tenantDomain: string,
  platform: string,
): Promise<ResolvedPlatformCredentials | null> {
  if (platform === "linkedin") {
    return getGlobalLinkedInCredentials();
  }
  const rowPlatform = resolveGlobalRowPlatform(platform);
  if (!rowPlatform) return null;
  const [row] = await db.select().from(globalPlatformCredentials)
    .where(eq(globalPlatformCredentials.platform, rowPlatform));
  if (!row) return null;
  try {
    const clientId = decryptSecret(row.encryptedClientId);
    const clientSecret = row.encryptedClientSecret ? decryptSecret(row.encryptedClientSecret) : null;
    if (!clientId) return null;
    return { clientId, clientSecret };
  } catch {
    console.warn(`[platform-credentials] decryption failed for global ${rowPlatform}`);
    return null;
  }
}

/**
 * Whether direct publishing is switched on for a platform's shared app. This is
 * the per-platform safety switch a Global Admin flips once the app clears
 * platform review. LinkedIn keeps its existing env-var gate.
 */
export async function isDirectPublishEnabled(platform: string): Promise<boolean> {
  if (platform === "linkedin") return isLinkedInDirectPublishEnabled();
  const rowPlatform = resolveGlobalRowPlatform(platform);
  if (!rowPlatform) return false;
  const [row] = await db.select({ enabled: globalPlatformCredentials.directPublishEnabled })
    .from(globalPlatformCredentials)
    .where(eq(globalPlatformCredentials.platform, rowPlatform));
  return !!row?.enabled;
}

export interface GlobalPlatformCredentialMetadata {
  platform: GlobalCredentialPlatform;
  isConfigured: boolean;
  hasSecret: boolean;
  directPublishEnabled: boolean;
  clientIdPreview: string | null;
  notes: string | null;
  updatedAt: Date | null;
}

/**
 * Metadata (no secrets) for every global platform, for the admin UI. Always
 * returns a row per platform — configured or not.
 */
export async function listGlobalPlatformCredentialMetadata(
  platforms: readonly GlobalCredentialPlatform[],
): Promise<GlobalPlatformCredentialMetadata[]> {
  const rows = await db.select().from(globalPlatformCredentials);
  const byPlatform = new Map(rows.map(r => [r.platform, r]));
  return platforms.map(platform => {
    const row = byPlatform.get(platform);
    if (!row) {
      return {
        platform,
        isConfigured: false,
        hasSecret: false,
        directPublishEnabled: false,
        clientIdPreview: null,
        notes: null,
        updatedAt: null,
      };
    }
    let clientIdPreview: string | null = null;
    try {
      clientIdPreview = maskClientId(decryptSecret(row.encryptedClientId));
    } catch {
      clientIdPreview = "(decrypt error)";
    }
    return {
      platform,
      isConfigured: true,
      hasSecret: !!row.encryptedClientSecret,
      directPublishEnabled: row.directPublishEnabled,
      clientIdPreview,
      notes: row.notes,
      updatedAt: row.updatedAt,
    };
  });
}

export async function upsertGlobalPlatformCredentials(input: {
  platform: GlobalCredentialPlatform;
  clientId: string;
  /** undefined = leave as-is; null = clear; string = replace. */
  clientSecret?: string | null;
  notes?: string | null;
  directPublishEnabled?: boolean;
  userId: string;
}): Promise<void> {
  const clientId = input.clientId.trim();
  if (!clientId) throw new Error("clientId is required");
  const encryptedClientId = encryptSecret(clientId);
  const encryptedClientSecret = input.clientSecret && input.clientSecret.trim()
    ? encryptSecret(input.clientSecret.trim())
    : null;

  const [existing] = await db.select({ id: globalPlatformCredentials.id })
    .from(globalPlatformCredentials)
    .where(eq(globalPlatformCredentials.platform, input.platform));

  if (existing) {
    await db.update(globalPlatformCredentials).set({
      encryptedClientId,
      // null = explicit clear; undefined = leave the existing secret alone.
      ...(input.clientSecret !== undefined ? { encryptedClientSecret } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      ...(input.directPublishEnabled !== undefined ? { directPublishEnabled: input.directPublishEnabled } : {}),
      updatedBy: input.userId,
      updatedAt: new Date(),
    }).where(eq(globalPlatformCredentials.id, existing.id));
  } else {
    await db.insert(globalPlatformCredentials).values({
      platform: input.platform,
      encryptedClientId,
      encryptedClientSecret,
      notes: input.notes ?? null,
      directPublishEnabled: input.directPublishEnabled ?? false,
      updatedBy: input.userId,
    });
  }
}

export async function deleteGlobalPlatformCredentials(
  platform: GlobalCredentialPlatform,
): Promise<void> {
  await db.delete(globalPlatformCredentials)
    .where(eq(globalPlatformCredentials.platform, platform));
}

function maskClientId(s: string): string {
  if (s.length <= 6) return "•".repeat(s.length);
  return `${s.slice(0, 4)}…${s.slice(-2)}`;
}
