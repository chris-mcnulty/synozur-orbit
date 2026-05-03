/**
 * Vega Launchpad direct-push client (Task #117).
 *
 * Posts a Vega export bundle (the same `.zip` users download via "Export for
 * Vega") to a tenant-configured Vega Launchpad endpoint using a shared API
 * key. The Launchpad is expected to expose:
 *
 *   POST  {baseUrl}/api/v1/plans   — accept a multipart upload (`bundle` field
 *                                    containing `plan.zip`) and return JSON
 *                                    `{ id: string, ... }`.
 *   GET   {baseUrl}/api/v1/health  — auth/connectivity probe.
 *
 * Both endpoints accept `Authorization: Bearer <apiKey>`.
 *
 * Security notes:
 *   - The Launchpad URL is admin-supplied, so every server-side fetch is
 *     gated through `validateUrlWithDnsCheck` to block SSRF to internal IPs.
 *   - The API key is encrypted at rest via `encryptSecret`; we only ever
 *     decrypt it inside this module right before signing a request.
 */

import { storage } from "../storage";
import { buildVegaExportBundle, VEGA_EXPORT_SCHEMA_VERSION } from "./vega-export";
import { encryptSecret, tryDecryptSecret } from "../utils/encryption";
import { validateUrlWithDnsCheck } from "../utils/url-validator";
import type { ContextFilter } from "../storage";

export interface VegaConnectionStatus {
  configured: boolean;
  url: string | null;
  workspaceId: string | null;
  connectedAt: Date | null;
  hasApiKey: boolean;
}

export interface VegaPushResult {
  ok: boolean;
  status: number;
  bundleId: string | null;
  error: string | null;
  pushedAt: Date;
}

function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

async function assertSafeUrl(url: string): Promise<void> {
  const trimmed = (url || "").trim();
  if (!/^https:\/\//i.test(trimmed)) {
    throw Object.assign(
      new Error("Vega Launchpad URL must use HTTPS — API keys cannot be sent over plaintext."),
      { status: 400 },
    );
  }
  const result = await validateUrlWithDnsCheck(trimmed);
  if (!result.isValid) {
    throw Object.assign(
      new Error(result.error || "Vega Launchpad URL failed safety validation"),
      { status: 400 },
    );
  }
}

export async function getVegaConnectionStatus(tenantDomain: string): Promise<VegaConnectionStatus> {
  const tenant = await storage.getTenantByDomain(tenantDomain);
  if (!tenant) {
    return { configured: false, url: null, workspaceId: null, connectedAt: null, hasApiKey: false };
  }
  const hasApiKey = !!tenant.vegaLaunchpadApiKey;
  const url = tenant.vegaLaunchpadUrl ?? null;
  return {
    configured: !!(url && hasApiKey),
    url,
    workspaceId: tenant.vegaLaunchpadWorkspaceId ?? null,
    connectedAt: tenant.vegaLaunchpadConnectedAt ?? null,
    hasApiKey,
  };
}

export async function setVegaCredentials(
  tenantId: string,
  data: { url: string; apiKey: string; workspaceId?: string | null },
): Promise<void> {
  await assertSafeUrl(data.url);
  await storage.updateTenant(tenantId, {
    vegaLaunchpadUrl: normalizeBaseUrl(data.url),
    vegaLaunchpadApiKey: encryptSecret(data.apiKey),
    vegaLaunchpadWorkspaceId: data.workspaceId ?? null,
    vegaLaunchpadConnectedAt: new Date(),
  });
}

export async function clearVegaCredentials(tenantId: string): Promise<void> {
  await storage.updateTenant(tenantId, {
    vegaLaunchpadUrl: null,
    vegaLaunchpadApiKey: null,
    vegaLaunchpadWorkspaceId: null,
    vegaLaunchpadConnectedAt: null,
  });
}

/**
 * Probe the Launchpad health endpoint to confirm the URL/API-key combo works
 * before we save them. Returns a normalized error message on failure. Also
 * runs SSRF protection so we never resolve admin input to a private IP.
 */
export async function verifyVegaCredentials(url: string, apiKey: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await assertSafeUrl(url);
  } catch (err: any) {
    return { ok: false, error: err?.message || "URL failed safety validation" };
  }
  const base = normalizeBaseUrl(url);
  try {
    const res = await fetch(`${base}/api/v1/health`, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
      redirect: "error",
    });
    if (!res.ok) {
      return { ok: false, error: `Health check returned ${res.status} ${res.statusText}` };
    }
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message || "Failed to reach Vega Launchpad" };
  }
}

/**
 * Build the Vega export bundle for `planId` and POST it (as the same `.zip`
 * users currently download) to the tenant's Launchpad. Records success or
 * failure on the marketing plan row regardless of outcome.
 */
async function recordPushFailure(
  planId: string,
  ctx: ContextFilter,
  pushedByUserId: string,
  error: string,
): Promise<VegaPushResult> {
  const pushedAt = new Date();
  try {
    await storage.updateMarketingPlan(
      planId,
      {
        vegaLastPushAt: pushedAt,
        vegaLastPushStatus: "failure",
        vegaLastPushError: error,
        vegaLastPushBundleId: null,
        vegaLastPushedBy: pushedByUserId,
      },
      ctx,
    );
  } catch {
    // best-effort: a failure to record history shouldn't mask the real error
  }
  return { ok: false, status: 0, bundleId: null, error, pushedAt };
}

export async function pushPlanToVega(
  planId: string,
  ctx: ContextFilter,
  pushedByUserId: string,
): Promise<VegaPushResult> {
  const plan = await storage.getMarketingPlan(planId, ctx);
  if (!plan) {
    throw Object.assign(new Error("Marketing plan not found"), { status: 404 });
  }

  const tenant = await storage.getTenantByDomain(ctx.tenantDomain);
  if (!tenant?.vegaLaunchpadUrl || !tenant.vegaLaunchpadApiKey) {
    const err = "Vega Launchpad is not connected. Configure the API URL and key first.";
    await recordPushFailure(planId, ctx, pushedByUserId, err);
    throw Object.assign(new Error(err), { status: 400 });
  }

  const apiKey = tryDecryptSecret(tenant.vegaLaunchpadApiKey);
  if (!apiKey) {
    const err = "Vega Launchpad API key could not be decrypted; reconnect to refresh it.";
    await recordPushFailure(planId, ctx, pushedByUserId, err);
    throw Object.assign(new Error(err), { status: 500 });
  }

  try {
    await assertSafeUrl(tenant.vegaLaunchpadUrl);
  } catch (err: any) {
    const msg = err?.message || "Vega Launchpad URL failed safety validation";
    await recordPushFailure(planId, ctx, pushedByUserId, msg);
    throw Object.assign(new Error(msg), { status: err?.status || 400 });
  }

  const bundle = await buildVegaExportBundle(planId, ctx, "zip");
  if (!bundle) {
    throw Object.assign(new Error("Marketing plan not found"), { status: 404 });
  }

  const base = normalizeBaseUrl(tenant.vegaLaunchpadUrl);
  const pushedAt = new Date();
  let result: VegaPushResult;
  try {
    const form = new FormData();
    form.append(
      "bundle",
      new Blob([bundle.body], { type: bundle.contentType }),
      bundle.filename,
    );
    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
      "X-Vega-Schema-Version": VEGA_EXPORT_SCHEMA_VERSION,
    };
    if (tenant.vegaLaunchpadWorkspaceId) {
      headers["X-Vega-Workspace"] = tenant.vegaLaunchpadWorkspaceId;
    }
    const res = await fetch(`${base}/api/v1/plans`, {
      method: "POST",
      headers,
      body: form,
      redirect: "error",
    });
    const text = await res.text();
    let bundleId: string | null = null;
    let errorMsg: string | null = null;
    try {
      const parsed = text ? JSON.parse(text) : null;
      if (parsed && typeof parsed === "object") {
        if (typeof parsed.id === "string") bundleId = parsed.id;
        if (!res.ok) errorMsg = parsed.error || parsed.message || null;
      }
    } catch {
      if (!res.ok) errorMsg = text.slice(0, 500);
    }
    result = {
      ok: res.ok,
      status: res.status,
      bundleId,
      error: res.ok ? null : errorMsg || `Launchpad returned ${res.status} ${res.statusText}`,
      pushedAt,
    };
  } catch (err: any) {
    result = {
      ok: false,
      status: 0,
      bundleId: null,
      error: err?.message || "Failed to reach Vega Launchpad",
      pushedAt,
    };
  }

  await storage.updateMarketingPlan(
    planId,
    {
      vegaLastPushAt: result.pushedAt,
      vegaLastPushStatus: result.ok ? "success" : "failure",
      vegaLastPushError: result.error,
      vegaLastPushBundleId: result.bundleId,
      vegaLastPushedBy: pushedByUserId,
    },
    ctx,
  );

  return result;
}
