/**
 * Marketing publish worker — Task #97
 *
 * Polls the database for `generated_posts` rows that:
 *   - status = 'approved'
 *   - scheduled_date <= now() AND >= 7 days ago (stale-backlog guard)
 *   - publish_next_attempt_at IS NULL OR <= now() (for retries)
 *   - belong to a campaign × social_account where auto_publish = true
 *   - the campaign is still `active` (completed/archived/deleted campaigns excluded)
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
import { eq, and, lte, gte, isNotNull, or, isNull, sql, ne, inArray } from "drizzle-orm";
import {
  generatedPosts,
  socialAccounts,
  campaignSocialAccounts,
  campaigns,
  socialPublishAttempts,
  marketingAuditLog,
} from "@shared/schema";
import { getPublisher } from "./social-publishers";
import { encryptSecret } from "../utils/encryption";
import { checkFeatureAccessAsync } from "./plan-policy";
import { tenants } from "@shared/schema";

// LinkedIn and other platforms enforce daily caps and flag rapid-fire posting
// as spam. Keep per-tick batch small and space posts out within each tick so
// the pattern looks human-paced. At 3 posts per tick every 2 min = 90/hour
// max, well under LinkedIn's ~150 posts/day limit and not triggering burst
// spam detection.
const MAX_POSTS_PER_TICK = 3;
const DELAY_BETWEEN_POSTS_MS = 12_000; // 12 seconds between posts within a tick
const MAX_PER_TENANT_PER_DAY = Number(process.env.MARKETING_DAILY_PUBLISH_CAP || 25);
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
    // Posts scheduled more than 7 days ago are treated as stale — they were
    // likely already exported to CSV, manually posted, or represent a backlog
    // from before auto-publish was active. Skipping them prevents surprise
    // bulk-posting of old content.
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // Two paths: campaign-linked posts must be on a campaign-social-account
    // link with autoPublish=true; standalone posts (campaignId IS NULL) are
    // self-authorizing — being approved + scheduled is enough.
    console.log(`[Marketing Publish Worker] Tick started — checking for posts due by ${now.toISOString()}`);

    const candidates = await db
      .select({
        post: generatedPosts,
        account: socialAccounts,
      })
      .from(generatedPosts)
      .innerJoin(socialAccounts, eq(socialAccounts.id, generatedPosts.socialAccountId))
      .leftJoin(
        campaignSocialAccounts,
        and(
          eq(campaignSocialAccounts.campaignId, generatedPosts.campaignId),
          eq(campaignSocialAccounts.socialAccountId, generatedPosts.socialAccountId),
        ),
      )
      .leftJoin(campaigns, eq(campaigns.id, generatedPosts.campaignId))
      .where(
        and(
          eq(generatedPosts.status, "approved"),
          isNotNull(generatedPosts.scheduledDate),
          lte(generatedPosts.scheduledDate, now),
          // Skip posts older than 7 days — stale backlog, likely already handled.
          gte(generatedPosts.scheduledDate, sevenDaysAgo),
          or(
            isNull(generatedPosts.publishNextAttemptAt),
            lte(generatedPosts.publishNextAttemptAt, now),
          ),
          // Naturalistic delay gate: skip posts that haven't reached their
          // jitter-deferred time yet. publishNotBefore IS NULL means the worker
          // hasn't applied jitter yet (handled below on first pick-up).
          or(
            isNull(generatedPosts.publishNotBefore),
            lte(generatedPosts.publishNotBefore, now),
          ),
          isNotNull(socialAccounts.encryptedAccessToken),
          eq(socialAccounts.status, "active"),
          // Skip accounts where the user has manually paused auto-publishing.
          eq(socialAccounts.publishingPaused, false),
          // Standalone (no campaign) OR a campaign link with autoPublish=true.
          or(
            isNull(generatedPosts.campaignId),
            eq(campaignSocialAccounts.autoPublish, true),
          ),
          // Skip posts explicitly reserved for CSV export only.
          or(
            isNull(generatedPosts.deliveryMode),
            ne(generatedPosts.deliveryMode, "csv"),
          ),
          // Only auto-publish posts from active campaigns. Posts tied to
          // completed, archived, or deleted campaigns are considered "closed"
          // and must not be published automatically — they may have already
          // been exported to CSV or manually posted. Standalone posts
          // (campaignId IS NULL) are always eligible.
          or(
            isNull(generatedPosts.campaignId),
            eq(campaigns.status, "active"),
          ),
        ),
      )
      .limit(MAX_POSTS_PER_TICK);

    console.log(`[Marketing Publish Worker] Found ${candidates.length} eligible candidate(s)`, candidates.map(c => ({
      id: c.post.id,
      platform: c.post.platform,
      scheduledDate: c.post.scheduledDate,
      socialAccountId: c.post.socialAccountId,
      campaignId: c.post.campaignId,
      deliveryMode: c.post.deliveryMode,
    })));

    // ── Same-minute stagger ─────────────────────────────────────────────────
    // If two or more posts share the same scheduled minute, spread the 2nd,
    // 3rd, etc. out by a random 2–6 minutes each (chained, so they never
    // land on the same minute as each other either). The updated rows are
    // written back to the DB and skipped this tick — they'll be picked up in
    // a later tick once their new scheduledDate arrives.
    {
      const minuteKey = (d: Date) => Math.floor(d.getTime() / 60_000);
      // Group by minute bucket
      const groups = new Map<number, Array<{ postId: string; baseTime: Date }>>();
      for (const { post } of candidates) {
        if (!post.scheduledDate) continue;
        const t = new Date(post.scheduledDate);
        const key = minuteKey(t);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push({ postId: post.id, baseTime: t });
      }
      const staggeredIds = new Set<string>();
      for (const group of groups.values()) {
        if (group.length <= 1) continue;
        let prevTime = group[0].baseTime;
        for (let i = 1; i < group.length; i++) {
          const jitterMin = 2 + Math.floor(Math.random() * 5); // 2–6 minutes
          const newTime = new Date(prevTime.getTime() + jitterMin * 60_000);
          await db
            .update(generatedPosts)
            .set({ scheduledDate: newTime, updatedAt: new Date() })
            .where(eq(generatedPosts.id, group[i].postId));
          console.log(
            `[PublishWorker] Staggered post ${group[i].postId} by +${jitterMin}min → ${newTime.toISOString()}`,
          );
          staggeredIds.add(group[i].postId);
          prevTime = newTime;
        }
      }
      // Remove staggered posts from this tick's work list
      candidates.splice(
        0,
        candidates.length,
        ...candidates.filter(({ post }) => !staggeredIds.has(post.id)),
      );
    }

    // ── Naturalistic posting delay (jitter) ────────────────────────────────
    // For posts where publishNotBefore is still null (first pick-up) and the
    // tenant has jitter enabled and the post doesn't request an exact schedule,
    // assign a random 0–600 s delay and skip this tick. The post re-enters the
    // queue once publishNotBefore has passed.
    const MAX_JITTER_SECONDS = 600;
    const jitterEnabledCache = new Map<string, boolean>();
    const isJitterEnabled = async (tenantDomain: string): Promise<boolean> => {
      const cached = jitterEnabledCache.get(tenantDomain);
      if (cached !== undefined) return cached;
      try {
        const [t] = await db
          .select({ socialPostingJitterEnabled: tenants.socialPostingJitterEnabled })
          .from(tenants)
          .where(eq(tenants.domain, tenantDomain));
        const enabled = t?.socialPostingJitterEnabled ?? true;
        jitterEnabledCache.set(tenantDomain, enabled);
        return enabled;
      } catch {
        jitterEnabledCache.set(tenantDomain, true);
        return true;
      }
    };

    const jitteredIds = new Set<string>();
    for (const { post } of candidates) {
      if (post.publishNotBefore !== null) continue; // already assigned a slot
      if ((post as any).exactSchedule) continue;     // user wants exact time
      if (!await isJitterEnabled(post.tenantDomain)) continue;

      const delaySec = Math.floor(Math.random() * (MAX_JITTER_SECONDS + 1));
      const publishNotBefore = new Date(now.getTime() + delaySec * 1000);
      await db
        .update(generatedPosts)
        .set({ publishNotBefore, updatedAt: new Date() } as any)
        .where(eq(generatedPosts.id, post.id));
      console.log(
        `[PublishWorker] Jitter: post ${post.id} deferred by +${delaySec}s → publishes at ${publishNotBefore.toISOString()}`,
      );
      jitteredIds.add(post.id);
    }
    // Remove jittered posts from this tick's work list (they'll be picked up later).
    candidates.splice(
      0,
      candidates.length,
      ...candidates.filter(({ post }) => !jitteredIds.has(post.id)),
    );

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

    const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

    for (const row of candidates) {
      // Pace posts: wait before each post (except the first) so they go out
      // 12 seconds apart — looks human, avoids LinkedIn burst-spam detection.
      if (processed > 0) await sleep(DELAY_BETWEEN_POSTS_MS);
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
    .leftJoin(socialAccounts, eq(socialAccounts.id, generatedPosts.socialAccountId))
    .where(eq(generatedPosts.id, postId));
  if (!row) return { success: false, errorMessage: "Post not found" };
  const { post, account } = row;
  if (!account) {
    return { success: false, errorMessage: "No social account linked to this post. Open the post and assign an account before publishing." };
  }
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

/**
 * Sweep for missed posts — runs on a short interval (every 5 min).
 *
 * Any `approved` post whose scheduledDate is more than 5 days in the past is
 * transitioned to `missed`. Missed posts are NOT eligible for auto-publishing
 * until an operator explicitly reschedules them (which resets status → approved).
 */
export async function sweepMissedPosts(): Promise<{ marked: number }> {
  const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
  // Only mark posts from active campaigns as missed. Posts from completed /
  // archived / deleted campaigns were intentionally not published — they
  // should not surface in the "rescue" queue.
  const activeCampaignIds = db
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(eq(campaigns.status, "active"));
  const result = await db
    .update(generatedPosts)
    .set({ status: "missed", updatedAt: new Date() })
    .where(
      and(
        eq(generatedPosts.status, "approved"),
        isNotNull(generatedPosts.scheduledDate),
        lte(generatedPosts.scheduledDate, fiveDaysAgo),
        or(
          isNull(generatedPosts.campaignId),
          inArray(generatedPosts.campaignId, activeCampaignIds),
        ),
      ),
    );
  const marked = (result as any)?.rowCount ?? 0;
  if (marked > 0) {
    console.log(`[Missed Post Sweep] Marked ${marked} overdue post(s) as missed.`);
  }
  return { marked };
}
