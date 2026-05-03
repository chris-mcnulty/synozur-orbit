/**
 * Marketing publish worker — Task #97
 *
 * Polls the database for `generated_posts` rows that:
 *   - status = 'approved'
 *   - scheduled_date <= now()
 *   - publish_next_attempt_at IS NULL OR <= now() (for retries)
 *   - belong to a campaign × social_account where auto_publish = true
 *   - the social account is connected (has encrypted_access_token)
 *
 * For each row, dispatches to the appropriate SocialPublisher and persists
 * the outcome (status: published | publish_failed) plus a row in
 * `social_publish_attempts` for the audit trail. Transient failures are
 * re-queued with exponential backoff up to MAX_ATTEMPTS; permanent failures
 * (token expired, missing author, platform unsupported) skip retries.
 *
 * The worker is invoked from `scheduled-jobs.ts` on a short interval. Each
 * tick processes a small batch with a per-tenant rate cap to prevent
 * runaway publishing.
 */

import { db } from "../db";
import { eq, and, lte, isNotNull, or, isNull, sql } from "drizzle-orm";
import {
  generatedPosts,
  socialAccounts,
  campaignSocialAccounts,
  socialPublishAttempts,
  marketingAuditLog,
} from "@shared/schema";
import { getPublisher } from "./social-publishers";
import { encryptSecret } from "../utils/encryption";
import { checkFeatureAccessAsync } from "./plan-policy";
import { tenants } from "@shared/schema";

const MAX_POSTS_PER_TICK = 25;
const MAX_PER_TENANT_PER_DAY = Number(process.env.MARKETING_DAILY_PUBLISH_CAP || 200);
const MAX_ATTEMPTS = 5;

// Exponential backoff in minutes for retries (1-indexed by attempt count).
const RETRY_BACKOFF_MINUTES = [5, 15, 60, 240, 1440];

// Permanent error codes — no point retrying these on the same record.
const PERMANENT_ERROR_CODES = new Set([
  "platform_unsupported",
  "not_connected",
  "missing_author",
  "token_decrypt_failed",
  "token_expired",
]);

const dailyCounters = new Map<string, { day: string; count: number }>();

function bumpAndCheckDailyCap(tenantDomain: string): boolean {
  const today = new Date().toISOString().slice(0, 10);
  const cur = dailyCounters.get(tenantDomain);
  if (!cur || cur.day !== today) {
    dailyCounters.set(tenantDomain, { day: today, count: 1 });
    return true;
  }
  if (cur.count >= MAX_PER_TENANT_PER_DAY) return false;
  cur.count += 1;
  return true;
}

let inFlight = false;

export async function tickMarketingPublishWorker(): Promise<{ processed: number; published: number; failed: number }> {
  if (inFlight) return { processed: 0, published: 0, failed: 0 };
  inFlight = true;
  let published = 0;
  let failed = 0;
  let processed = 0;
  try {
    const now = new Date();
    const candidates = await db
      .select({
        post: generatedPosts,
        account: socialAccounts,
      })
      .from(generatedPosts)
      .innerJoin(socialAccounts, eq(socialAccounts.id, generatedPosts.socialAccountId))
      .innerJoin(
        campaignSocialAccounts,
        and(
          eq(campaignSocialAccounts.campaignId, generatedPosts.campaignId),
          eq(campaignSocialAccounts.socialAccountId, generatedPosts.socialAccountId),
          eq(campaignSocialAccounts.autoPublish, true),
        ),
      )
      .where(
        and(
          eq(generatedPosts.status, "approved"),
          isNotNull(generatedPosts.scheduledDate),
          lte(generatedPosts.scheduledDate, now),
          or(
            isNull(generatedPosts.publishNextAttemptAt),
            lte(generatedPosts.publishNextAttemptAt, now),
          ),
          isNotNull(socialAccounts.encryptedAccessToken),
          eq(socialAccounts.status, "active"),
        ),
      )
      .limit(MAX_POSTS_PER_TICK);

    // Cache plan-gate decisions per tenant for the duration of this tick so
    // we don't re-query for every candidate row. Worker re-checks ensure a
    // tenant downgrade after a post is scheduled is honored before publish.
    const planGateCache = new Map<string, boolean>();
    const isAllowed = async (tenantDomain: string): Promise<boolean> => {
      const cached = planGateCache.get(tenantDomain);
      if (cached !== undefined) return cached;
      let plan = "free";
      try {
        const [t] = await db.select({ plan: tenants.plan }).from(tenants)
          .where(eq(tenants.domain, tenantDomain));
        plan = t?.plan || "free";
      } catch {}
      const gate = await checkFeatureAccessAsync(plan, "directPublishing");
      planGateCache.set(tenantDomain, gate.allowed);
      return gate.allowed;
    };

    for (const row of candidates) {
      processed += 1;
      const { post, account } = row;
      if (!await isAllowed(post.tenantDomain)) {
        await db.update(generatedPosts).set({
          status: "publish_failed",
          publishError: "Direct publishing is not enabled on this tenant's plan.",
          publishNextAttemptAt: null,
          updatedAt: new Date(),
        }).where(eq(generatedPosts.id, post.id));
        await db.insert(marketingAuditLog).values({
          tenantDomain: post.tenantDomain,
          marketId: account.marketId ?? null,
          userId: null,
          action: "social_publish",
          entityType: "generated_post",
          entityId: post.id,
          status: "error",
          message: "Plan does not include direct publishing",
          details: { platform: post.platform },
        });
        failed += 1;
        continue;
      }
      if (!bumpAndCheckDailyCap(post.tenantDomain)) {
        await db.insert(marketingAuditLog).values({
          tenantDomain: post.tenantDomain,
          marketId: account.marketId ?? null,
          userId: null,
          action: "rate_limited",
          entityType: "generated_post",
          entityId: post.id,
          status: "warning",
          message: `Daily publish cap of ${MAX_PER_TENANT_PER_DAY} reached`,
          details: { platform: post.platform },
        });
        continue;
      }

      const publisher = getPublisher(post.platform);
      if (!publisher || !publisher.supported) {
        await markFailed(post.id, account.id, post.platform, post.tenantDomain, {
          success: false,
          errorCode: "platform_unsupported",
          errorMessage: `Direct publishing is not implemented for ${post.platform}.`,
        }, post.publishAttemptCount ?? 0);
        failed += 1;
        continue;
      }

      try {
        const result = await publisher.publish({ account, post });
        if (result.success) {
          if (result.refreshedAccessToken) {
            await db.update(socialAccounts).set({
              encryptedAccessToken: encryptSecret(result.refreshedAccessToken),
              encryptedRefreshToken: result.refreshedRefreshToken
                ? encryptSecret(result.refreshedRefreshToken)
                : account.encryptedRefreshToken,
              tokenExpiresAt: result.refreshedTokenExpiresAt ?? account.tokenExpiresAt,
              updatedAt: new Date(),
            }).where(eq(socialAccounts.id, account.id));
          }
          await db.update(generatedPosts).set({
            status: "published",
            publishedAt: new Date(),
            publishedUrl: result.publishedUrl ?? null,
            publishError: null,
            publishNextAttemptAt: null,
            publishAttemptCount: (post.publishAttemptCount ?? 0) + 1,
            updatedAt: new Date(),
          }).where(eq(generatedPosts.id, post.id));
          await db.insert(socialPublishAttempts).values({
            postId: post.id,
            socialAccountId: account.id,
            tenantDomain: post.tenantDomain,
            platform: post.platform,
            status: "success",
            publishedUrl: result.publishedUrl ?? null,
            errorCode: null,
            errorMessage: null,
            responsePayload: toJsonPayload(result.responsePayload),
            attemptedBy: null,
          });
          await db.insert(marketingAuditLog).values({
            tenantDomain: post.tenantDomain,
            marketId: account.marketId ?? null,
            userId: null,
            action: "social_publish",
            entityType: "generated_post",
            entityId: post.id,
            status: "ok",
            message: `Published to ${post.platform}`,
            details: { url: result.publishedUrl, accountId: account.id },
          });
          published += 1;
        } else {
          await markFailed(post.id, account.id, post.platform, post.tenantDomain, result, post.publishAttemptCount ?? 0);
          failed += 1;
        }
      } catch (err: any) {
        await markFailed(post.id, account.id, post.platform, post.tenantDomain, {
          success: false,
          errorCode: "exception",
          errorMessage: err?.message || String(err),
        }, post.publishAttemptCount ?? 0);
        failed += 1;
      }
    }
  } finally {
    inFlight = false;
  }
  return { processed, published, failed };
}

function toJsonPayload(value: unknown): unknown {
  if (value === undefined || value === null) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value) || typeof value === "object") return value as Record<string, unknown> | unknown[];
  return null;
}

/**
 * Persist a failed publish attempt. Transient failures (network, 5xx,
 * unknown errorCode) re-queue the post with exponential backoff while
 * `attemptCount < MAX_ATTEMPTS`. Permanent failures or attempts exhausted
 * mark the post as `publish_failed` so the user must intervene.
 */
async function markFailed(
  postId: string,
  accountId: string,
  platform: string,
  tenantDomain: string,
  result: { success: boolean; errorCode?: string; errorMessage?: string; responsePayload?: unknown },
  prevAttempts = 0,
) {
  const newAttemptCount = prevAttempts + 1;
  const errorCode = result.errorCode ?? null;
  const isPermanent = errorCode ? PERMANENT_ERROR_CODES.has(errorCode) : false;
  const shouldRetry = !isPermanent && newAttemptCount < MAX_ATTEMPTS;

  if (shouldRetry) {
    const backoffMins = RETRY_BACKOFF_MINUTES[Math.min(newAttemptCount - 1, RETRY_BACKOFF_MINUTES.length - 1)];
    const nextAttemptAt = new Date(Date.now() + backoffMins * 60_000);
    await db.update(generatedPosts).set({
      // keep status as 'approved' so the worker re-picks it up after backoff
      status: "approved",
      publishError: result.errorMessage ?? "Publish failed",
      publishAttemptCount: newAttemptCount,
      publishNextAttemptAt: nextAttemptAt,
      updatedAt: new Date(),
    }).where(eq(generatedPosts.id, postId));
  } else {
    await db.update(generatedPosts).set({
      status: "publish_failed",
      publishError: result.errorMessage ?? "Publish failed",
      publishAttemptCount: newAttemptCount,
      publishNextAttemptAt: null,
      updatedAt: new Date(),
    }).where(eq(generatedPosts.id, postId));
  }

  await db.update(socialAccounts).set({
    lastPublishError: result.errorMessage ?? "Publish failed",
    updatedAt: new Date(),
  }).where(eq(socialAccounts.id, accountId));

  await db.insert(socialPublishAttempts).values({
    postId,
    socialAccountId: accountId,
    tenantDomain,
    platform,
    status: shouldRetry ? "retry_scheduled" : "error",
    errorCode,
    errorMessage: result.errorMessage ?? null,
    responsePayload: toJsonPayload(result.responsePayload),
  });

  await db.insert(marketingAuditLog).values({
    tenantDomain,
    marketId: null,
    userId: null,
    action: "social_publish",
    entityType: "generated_post",
    entityId: postId,
    status: shouldRetry ? "warning" : "error",
    message: result.errorMessage ?? "Publish failed",
    details: {
      platform,
      errorCode,
      attempt: newAttemptCount,
      maxAttempts: MAX_ATTEMPTS,
      retrying: shouldRetry,
    },
  });
}

/**
 * Manual one-shot publish — used by the "Publish now" UI button. Bypasses
 * the schedule check but still respects platform support, the daily cap,
 * and approval gating (only `approved` or `publish_failed` posts may be
 * published manually — never drafts or already-published posts).
 */
export async function publishPostNow(
  postId: string,
  attemptedBy: string,
): Promise<{ success: boolean; publishedUrl?: string | null; errorMessage?: string }> {
  const [row] = await db
    .select({ post: generatedPosts, account: socialAccounts })
    .from(generatedPosts)
    .innerJoin(socialAccounts, eq(socialAccounts.id, generatedPosts.socialAccountId))
    .where(eq(generatedPosts.id, postId));
  if (!row) return { success: false, errorMessage: "Post not found" };
  const { post, account } = row;
  if (post.status !== "approved" && post.status !== "publish_failed") {
    return {
      success: false,
      errorMessage: `Post must be approved before publishing (current status: ${post.status}).`,
    };
  }
  if (!account.encryptedAccessToken) {
    return { success: false, errorMessage: "Account is not connected" };
  }
  if (!bumpAndCheckDailyCap(post.tenantDomain)) {
    return { success: false, errorMessage: `Daily publish cap of ${MAX_PER_TENANT_PER_DAY} reached` };
  }
  const publisher = getPublisher(post.platform);
  if (!publisher || !publisher.supported) {
    await markFailed(post.id, account.id, post.platform, post.tenantDomain, {
      success: false,
      errorCode: "platform_unsupported",
      errorMessage: `Direct publishing is not implemented for ${post.platform}.`,
    }, post.publishAttemptCount ?? 0);
    return { success: false, errorMessage: `Direct publishing is not implemented for ${post.platform}.` };
  }

  const result = await publisher.publish({ account, post, attemptedBy });
  if (result.success) {
    await db.update(generatedPosts).set({
      status: "published",
      publishedAt: new Date(),
      publishedUrl: result.publishedUrl ?? null,
      publishError: null,
      publishNextAttemptAt: null,
      publishAttemptCount: (post.publishAttemptCount ?? 0) + 1,
      updatedAt: new Date(),
    }).where(eq(generatedPosts.id, post.id));
    await db.insert(socialPublishAttempts).values({
      postId: post.id,
      socialAccountId: account.id,
      tenantDomain: post.tenantDomain,
      platform: post.platform,
      status: "success",
      publishedUrl: result.publishedUrl ?? null,
      responsePayload: toJsonPayload(result.responsePayload),
      attemptedBy,
    });
    await db.insert(marketingAuditLog).values({
      tenantDomain: post.tenantDomain,
      marketId: account.marketId ?? null,
      userId: attemptedBy,
      action: "social_publish",
      entityType: "generated_post",
      entityId: post.id,
      status: "ok",
      message: `Manually published to ${post.platform}`,
      details: { url: result.publishedUrl, accountId: account.id },
    });
    return { success: true, publishedUrl: result.publishedUrl };
  }
  await markFailed(post.id, account.id, post.platform, post.tenantDomain, result, post.publishAttemptCount ?? 0);
  return { success: false, errorMessage: result.errorMessage };
}
