import type { Request } from "express";

export const isRecaptchaConfigured = () => Boolean(process.env.RECAPTCHA_SECRET_KEY);

export const getRecaptchaSiteKey = () => process.env.RECAPTCHA_SITE_KEY || "";

const V3_MIN_SCORE = 0.5;

interface VerifyResult {
  ok: boolean;
  score?: number;
  needsChallenge?: boolean;
  reason?: string;
}

/**
 * Verify a reCAPTCHA token. If `version === "v2"`, no score gating happens —
 * a successful verification accepts the request. For v3, scores < 0.5 fall
 * through to "needsChallenge" so the client can render a v2 checkbox.
 *
 * If `RECAPTCHA_SECRET_KEY` is not configured, verification is skipped (so
 * the server still works in dev / for tests). Production deployments should
 * always set the env var.
 */
export async function verifyRecaptcha(
  token: string | undefined,
  version: "v3" | "v2",
  remoteIp?: string
): Promise<VerifyResult> {
  if (!isRecaptchaConfigured()) {
    return { ok: true, reason: "recaptcha_not_configured" };
  }
  if (!token || typeof token !== "string") {
    return { ok: false, reason: "missing_token" };
  }
  try {
    const params = new URLSearchParams();
    params.set("secret", process.env.RECAPTCHA_SECRET_KEY || "");
    params.set("response", token);
    if (remoteIp) params.set("remoteip", remoteIp);
    const res = await fetch("https://www.google.com/recaptcha/api/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    const data: any = await res.json();
    if (!data?.success) {
      return { ok: false, reason: `verify_failed:${(data?.["error-codes"] || []).join(",")}` };
    }
    if (version === "v3") {
      const score = typeof data.score === "number" ? data.score : 0;
      if (score < V3_MIN_SCORE) {
        return { ok: false, score, needsChallenge: true, reason: "low_score" };
      }
      return { ok: true, score };
    }
    // v2: a successful response is sufficient
    return { ok: true };
  } catch (err: any) {
    console.error("[reCAPTCHA] Verify call failed:", err?.message || err);
    return { ok: false, reason: "network_error" };
  }
}

// ─── Per-IP sliding-window rate limiter for signup / resend routes ─────────
const RATE_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const RATE_MAX = 10;
const buckets = new Map<string, number[]>();

export function getClientIp(req: Request): string {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.length > 0) {
    return xff.split(",")[0].trim();
  }
  return req.ip || req.socket.remoteAddress || "unknown";
}

export function checkSignupRateLimit(ip: string): { allowed: boolean; resetAt: number } {
  const now = Date.now();
  const cutoff = now - RATE_WINDOW_MS;
  const arr = (buckets.get(ip) || []).filter((t) => t > cutoff);
  if (arr.length >= RATE_MAX) {
    return { allowed: false, resetAt: arr[0] + RATE_WINDOW_MS };
  }
  arr.push(now);
  buckets.set(ip, arr);
  return { allowed: true, resetAt: now + RATE_WINDOW_MS };
}

export function logAuditEvent(
  action: string,
  details: Record<string, any>
) {
  // Lightweight structured audit line — surfaces in workflow logs and is
  // searchable from deployment log tooling. Persistent audit table is
  // intentionally not extended in this task.
  try {
    console.log(`[audit] ${action} ${JSON.stringify(details)}`);
  } catch {
    console.log(`[audit] ${action}`);
  }
}
