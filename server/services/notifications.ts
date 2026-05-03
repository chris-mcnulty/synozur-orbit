/**
 * Central tenant-scoped notification dispatcher.
 *
 * Single entry point — `notifications.dispatch(tenantDomain, category, ctx)` —
 * that owns fan-out across every channel (in-app, email, Slack/Teams webhooks)
 * for the four supported event categories. Call sites should never reach into
 * channel-specific helpers (`createNotification`, `sendCompetitorAlertEmail`,
 * `sendWeeklyDigestEmail`, etc.) directly for these events; they should call
 * `notifications.dispatch` instead so adding a new channel later happens in
 * exactly one place.
 *
 * The dispatcher silently no-ops when the tenant's plan does not entitle a
 * channel (e.g. webhook integrations are Enterprise/Unlimited only) and
 * records the result on each integration row so the Settings UI can surface
 * delivery health.
 */

import { storage } from "../storage";
import { decryptSecret } from "../utils/encryption";
import { isFeatureEnabledAsync } from "./plan-policy";
import { createNotification } from "./notification-service";
import {
  sendCompetitorAlertEmail,
  sendWeeklyDigestEmail,
  sendSeoMovementAlertEmail,
  type BriefingDigestData,
} from "./email-service";
import {
  buildSlackPayload,
  buildTeamsPayload,
  buildCompetitorChangePayload,
  buildBriefingReadyPayload,
  buildWeeklyDigestPayload,
  buildJobFailedPayload,
  buildSeoMovementPayload,
  type WebhookPayload,
  type SeoMover,
} from "./webhook-formatters";
import type {
  IntegrationConfig,
  WebhookEventCategory,
} from "@shared/schema";

const WEBHOOK_TIMEOUT_MS = 10_000;

type Significance = "high" | "medium" | "low";

const ALERT_THRESHOLD_MAP: Record<string, Significance[]> = {
  high: ["high"],
  medium: ["high", "medium"],
  all: ["high", "medium", "low"],
};

function meetsThreshold(threshold: string, sig: Significance): boolean {
  return (ALERT_THRESHOLD_MAP[threshold] || ALERT_THRESHOLD_MAP.high).includes(sig);
}

function defaultBaseUrl(): string {
  if (process.env.BASE_URL) return process.env.BASE_URL;
  if (process.env.REPLIT_DEV_DOMAIN) return `https://${process.env.REPLIT_DEV_DOMAIN}`;
  if (process.env.REPLIT_DEPLOYMENT_URL) return `https://${process.env.REPLIT_DEPLOYMENT_URL}`;
  return "https://orbit.synozur.com";
}

// ---------------------------------------------------------------------------
// Webhook delivery (private)
// ---------------------------------------------------------------------------

interface PostResult {
  ok: boolean;
  status: number;
  error?: string;
}

async function postWebhook(url: string, body: unknown): Promise<PostResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, status: res.status, error: text.slice(0, 500) || res.statusText };
    }
    return { ok: true, status: res.status };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, status: 0, error: msg };
  } finally {
    clearTimeout(timeout);
  }
}

async function deliverToConfig(
  config: IntegrationConfig,
  payload: WebhookPayload,
): Promise<boolean> {
  let url: string;
  try {
    url = decryptSecret(config.encryptedWebhookUrl);
  } catch (err) {
    console.error(`[Notifications] Failed to decrypt webhook ${config.id}:`, err);
    await storage.markIntegrationConfigError(config.id, "Decryption failed").catch(() => {});
    return false;
  }

  const body = config.kind === "slack"
    ? buildSlackPayload(payload)
    : buildTeamsPayload(payload);
  const result = await postWebhook(url, body);

  if (result.ok) {
    await storage.markIntegrationConfigSuccess(config.id).catch(() => {});
    return true;
  }

  console.warn(
    `[Notifications] ${config.kind} webhook ${config.id} failed (${result.status}): ${result.error}`,
  );
  await storage.markIntegrationConfigError(
    config.id,
    `${result.status}: ${result.error || "Unknown error"}`.slice(0, 500),
  ).catch(() => {});
  return false;
}

async function fanOutWebhook(
  tenantDomain: string,
  category: WebhookEventCategory,
  payload: WebhookPayload,
): Promise<void> {
  try {
    const tenant = await storage.getTenantByDomain(tenantDomain);
    if (!tenant || tenant.status !== "active") return;

    const enabled = await isFeatureEnabledAsync(tenant.plan, "webhookIntegrations");
    if (!enabled) return;

    const configs = await storage.getIntegrationConfigsForCategory(tenantDomain, category);
    if (configs.length === 0) return;

    const results = await Promise.allSettled(
      configs.map((c) => deliverToConfig(c, payload)),
    );
    let delivered = 0;
    let failed = 0;
    for (const r of results) {
      if (r.status === "fulfilled" && r.value) delivered++;
      else failed++;
    }
    console.log(
      `[Notifications] webhook ${tenantDomain} category=${category} delivered=${delivered} failed=${failed}`,
    );
  } catch (err) {
    console.error(`[Notifications] webhook fan-out failed for ${tenantDomain}/${category}:`, err);
  }
}

// ---------------------------------------------------------------------------
// Per-category contexts
// ---------------------------------------------------------------------------

export interface CompetitorChangeCtx {
  competitorId: string;
  competitorName: string;
  summary: string;
  significance: Significance;
}

export interface BriefingReadyCtx {
  briefingId: string;
  marketId?: string | null;
  periodLabel?: string;
  executiveSummary: string;
  actionItemCount: number;
  riskAlertCount: number;
}

export interface WeeklyDigestCtx {
  /** Pre-computed activity payload for this tenant. */
  activities: { competitorName: string; type: string; description: string; summary?: string }[];
  briefing?: BriefingDigestData;
}

export interface JobFailedCtx {
  jobType: string;
  targetName?: string;
  error: string;
  attempts?: number;
}

export interface SeoMovementCtx {
  marketId?: string | null;
  marketName?: string;
  topGainers: SeoMover[];
  topLosers: SeoMover[];
}

type DispatchCtxMap = {
  competitor_change: CompetitorChangeCtx;
  briefing_ready: BriefingReadyCtx;
  weekly_digest: WeeklyDigestCtx;
  job_failed: JobFailedCtx;
  seo_movement: SeoMovementCtx;
};

// ---------------------------------------------------------------------------
// Per-category handlers (private)
// ---------------------------------------------------------------------------

async function handleCompetitorChange(
  tenantDomain: string,
  ctx: CompetitorChangeCtx,
): Promise<void> {
  const tenant = await storage.getTenantByDomain(tenantDomain);
  if (!tenant) return;
  if (!(await isFeatureEnabledAsync(tenant.plan, "competitorAlerts"))) return;

  const baseUrl = defaultBaseUrl();
  const link = `${baseUrl}/app/competitors/${ctx.competitorId}`;

  const users = await storage.getUsersByDomain(tenantDomain);
  const eligibleUsers = users.filter(
    (u) => u.alertsEnabled && meetsThreshold(u.alertThreshold || "high", ctx.significance),
  );

  await Promise.allSettled(
    eligibleUsers.map(async (user) => {
      try {
        await createNotification({
          userId: user.id,
          tenantDomain,
          type: "competitor_change",
          title: `${ctx.competitorName} — ${ctx.significance} significance change`,
          message: ctx.summary,
          link: `/app/competitors/${ctx.competitorId}`,
          readAt: null,
        });
      } catch (err) {
        console.error(`[Notifications] in-app failed for user ${user.id}:`, err);
      }

      if (user.alertEmailEnabled) {
        try {
          await sendCompetitorAlertEmail({
            to: user.email,
            userName: user.name,
            competitorName: ctx.competitorName,
            competitorId: ctx.competitorId,
            summary: ctx.summary,
            significance: ctx.significance,
            baseUrl,
          });
        } catch (err) {
          console.error(`[Notifications] alert email failed for user ${user.id}:`, err);
        }
      }
    }),
  );

  if (eligibleUsers.length > 0) {
    console.log(
      `[Notifications] competitor_change alerts dispatched to ${eligibleUsers.length} user(s) in ${tenantDomain}`,
    );
  }

  await fanOutWebhook(
    tenantDomain,
    "competitor_change",
    buildCompetitorChangePayload({
      competitorName: ctx.competitorName,
      significance: ctx.significance,
      summary: ctx.summary,
      link,
    }),
  );
}

async function handleBriefingReady(
  tenantDomain: string,
  ctx: BriefingReadyCtx,
): Promise<void> {
  const tenant = await storage.getTenantByDomain(tenantDomain);
  if (!tenant) return;

  const baseUrl = defaultBaseUrl();
  await fanOutWebhook(
    tenantDomain,
    "briefing_ready",
    buildBriefingReadyPayload({
      tenantName: tenant.name || tenantDomain,
      periodLabel: ctx.periodLabel,
      executiveSummary: ctx.executiveSummary,
      actionItemCount: ctx.actionItemCount,
      riskAlertCount: ctx.riskAlertCount,
      link: `${baseUrl}/app/intelligence`,
    }),
  );
}

async function handleWeeklyDigest(
  tenantDomain: string,
  ctx: WeeklyDigestCtx,
): Promise<void> {
  const tenant = await storage.getTenantByDomain(tenantDomain);
  if (!tenant || tenant.status !== "active") return;

  const baseUrl = defaultBaseUrl();
  const tenantUsers = await storage.getUsersByDomain(tenantDomain);
  const recipients = tenantUsers.filter((u) => u.weeklyDigestEnabled);

  let emailsSent = 0;
  for (const user of recipients) {
    try {
      const sent = await sendWeeklyDigestEmail({
        email: user.email,
        name: user.name,
        companyName: tenant.name,
        activities: ctx.activities,
        baseUrl,
        briefing: ctx.briefing,
      });
      if (sent) emailsSent++;
    } catch (err) {
      console.error(`[Notifications] digest email failed for ${user.email}:`, err);
    }
  }

  if (recipients.length > 0) {
    console.log(
      `[Notifications] weekly_digest emailed ${emailsSent}/${recipients.length} user(s) in ${tenantDomain}`,
    );
  }

  await fanOutWebhook(
    tenantDomain,
    "weekly_digest",
    buildWeeklyDigestPayload({
      tenantName: tenant.name,
      activityCount: ctx.activities.length,
      topActivities: ctx.activities.slice(0, 5).map((a) => ({
        competitorName: a.competitorName,
        description: a.summary || a.description,
      })),
      link: `${baseUrl}/app/dashboard`,
    }),
  );
}

async function handleSeoMovement(
  tenantDomain: string,
  ctx: SeoMovementCtx,
): Promise<void> {
  const tenant = await storage.getTenantByDomain(tenantDomain);
  if (!tenant || tenant.status !== "active") return;

  // Gate behind the seoTracking feature key — same gate as the job that
  // produced the metrics, but enforced again here so a misconfigured caller
  // can never email customers on a plan that doesn't entitle SEO tracking.
  if (!(await isFeatureEnabledAsync(tenant.plan, "seoTracking"))) return;

  const total = ctx.topGainers.length + ctx.topLosers.length;
  if (total === 0) return;

  const baseUrl = defaultBaseUrl();
  const seoLink = `${baseUrl}/app/seo`;
  const marketLabel = ctx.marketName;

  // Reuse the same tenant-level alert preferences as competitor_change so
  // customers don't have a separate toggle to manage. `alertsEnabled` opts
  // into in-app notifications; `alertEmailEnabled` adds the email channel.
  const users = await storage.getUsersByDomain(tenantDomain);
  const eligibleUsers = users.filter((u) => u.alertsEnabled || u.alertEmailEnabled);

  const summary = `${total} significant week-over-week ranking change${total === 1 ? "" : "s"}${
    marketLabel ? ` in ${marketLabel}` : ""
  }`;

  await Promise.allSettled(
    eligibleUsers.map(async (user) => {
      if (user.alertsEnabled) {
        try {
          await createNotification({
            userId: user.id,
            tenantDomain,
            type: "seo_movement",
            title: marketLabel
              ? `SEO movement detected — ${marketLabel}`
              : "SEO movement detected",
            message: summary,
            link: "/app/seo",
            readAt: null,
          });
        } catch (err) {
          console.error(`[Notifications] in-app seo_movement failed for user ${user.id}:`, err);
        }
      }

      if (user.alertEmailEnabled) {
        try {
          await sendSeoMovementAlertEmail({
            to: user.email,
            userName: user.name,
            companyName: tenant.name,
            marketLabel,
            topGainers: ctx.topGainers,
            topLosers: ctx.topLosers,
            baseUrl,
          });
        } catch (err) {
          console.error(`[Notifications] seo_movement email failed for user ${user.id}:`, err);
        }
      }
    }),
  );

  if (eligibleUsers.length > 0) {
    console.log(
      `[Notifications] seo_movement alerts dispatched to ${eligibleUsers.length} user(s) in ${tenantDomain} (${total} mover(s))`,
    );
  }

  await fanOutWebhook(
    tenantDomain,
    "seo_movement",
    buildSeoMovementPayload({
      tenantName: tenant.name || tenantDomain,
      marketName: marketLabel,
      topGainers: ctx.topGainers,
      topLosers: ctx.topLosers,
      link: seoLink,
    }),
  );
}

async function handleJobFailed(
  tenantDomain: string,
  ctx: JobFailedCtx,
): Promise<void> {
  await fanOutWebhook(
    tenantDomain,
    "job_failed",
    buildJobFailedPayload({
      jobType: ctx.jobType,
      targetName: ctx.targetName,
      error: ctx.error,
      attempts: ctx.attempts ?? 1,
    }),
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const notifications = {
  /**
   * Single canonical entry point for tenant notifications. Routes the event
   * to every channel relevant to the category (in-app, email, webhooks).
   * Errors in any channel are logged but do not throw, so a transient
   * failure in one channel cannot stop another from delivering.
   */
  async dispatch<C extends WebhookEventCategory>(
    tenantDomain: string,
    category: C,
    ctx: DispatchCtxMap[C],
  ): Promise<void> {
    if (!tenantDomain) return;
    try {
      switch (category) {
        case "competitor_change":
          await handleCompetitorChange(tenantDomain, ctx as CompetitorChangeCtx);
          break;
        case "briefing_ready":
          await handleBriefingReady(tenantDomain, ctx as BriefingReadyCtx);
          break;
        case "weekly_digest":
          await handleWeeklyDigest(tenantDomain, ctx as WeeklyDigestCtx);
          break;
        case "job_failed":
          await handleJobFailed(tenantDomain, ctx as JobFailedCtx);
          break;
        case "seo_movement":
          await handleSeoMovement(tenantDomain, ctx as SeoMovementCtx);
          break;
      }
    } catch (err) {
      console.error(`[Notifications] dispatch ${category} failed for ${tenantDomain}:`, err);
    }
  },

  /**
   * Send a verification message to a single webhook config (used by the
   * "Send test" button in Settings). Bypasses category filtering but still
   * requires the tenant plan to support webhook integrations.
   */
  async test(
    configId: string,
    triggeredByUserName: string,
  ): Promise<{ ok: boolean; error?: string }> {
    const config = await storage.getIntegrationConfig(configId);
    if (!config) return { ok: false, error: "Webhook not found" };

    const tenant = await storage.getTenantByDomain(config.tenantDomain);
    if (!tenant) return { ok: false, error: "Tenant not found" };

    const enabled = await isFeatureEnabledAsync(tenant.plan, "webhookIntegrations");
    if (!enabled) {
      return {
        ok: false,
        error: "Webhook integrations require an Enterprise or Unlimited plan.",
      };
    }

    const payload: WebhookPayload = {
      category: "competitor_change",
      title: "Orbit test message",
      summary: `${triggeredByUserName} sent a test message from ${tenant.name || config.tenantDomain}.`,
      facts: [
        { label: "Webhook", value: config.name },
        { label: "Channel", value: config.kind === "slack" ? "Slack" : "Microsoft Teams" },
        { label: "Tenant", value: config.tenantDomain },
      ],
      color: "#810FFB",
    };

    const ok = await deliverToConfig(config, payload);
    if (ok) return { ok: true };
    const fresh = await storage.getIntegrationConfig(configId);
    return { ok: false, error: fresh?.lastError || "Webhook delivery failed" };
  },
};
