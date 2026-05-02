/**
 * Encryption helper — AES-256-GCM for tenant secrets at rest.
 *
 * Used for webhook URLs (Slack/Teams) and other sensitive per-tenant values.
 * The encryption key is derived from `INTEGRATION_ENCRYPTION_KEY` if set,
 * otherwise from `SESSION_SECRET` via scrypt. Ciphertext is stored as a
 * base64 blob `v1:<iv>:<authTag>:<ciphertext>` so we can rotate algorithms
 * later by bumping the version prefix.
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";

const ALGO = "aes-256-gcm";
const IV_LENGTH = 12;
const KEY_LENGTH = 32;
const VERSION = "v1";

let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (cachedKey) return cachedKey;
  const seed =
    process.env.INTEGRATION_ENCRYPTION_KEY ||
    process.env.SESSION_SECRET ||
    "";
  if (!seed) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "Refusing to encrypt: INTEGRATION_ENCRYPTION_KEY (or SESSION_SECRET) must be set in production.",
      );
    }
    // Dev fallback — allow local dev to work with an obvious-looking ephemeral seed.
    // Note: this is non-deterministic across restarts, so any data encrypted under
    // it will become unreadable after restart. Acceptable for dev only.
    cachedKey = scryptSync("orbit-dev-only-ephemeral", "orbit-integration-salt-v1", KEY_LENGTH);
    return cachedKey;
  }
  cachedKey = scryptSync(seed, "orbit-integration-salt-v1", KEY_LENGTH);
  return cachedKey;
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGO, getKey(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${VERSION}:${iv.toString("base64")}:${tag.toString("base64")}:${ct.toString("base64")}`;
}

export function decryptSecret(blob: string): string {
  const parts = blob.split(":");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error("Invalid encrypted payload");
  }
  const iv = Buffer.from(parts[1], "base64");
  const tag = Buffer.from(parts[2], "base64");
  const ct = Buffer.from(parts[3], "base64");
  const decipher = createDecipheriv(ALGO, getKey(), iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString("utf8");
}

export function tryDecryptSecret(blob: string): string | null {
  try {
    return decryptSecret(blob);
  } catch {
    return null;
  }
}
