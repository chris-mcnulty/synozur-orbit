/**
 * Publish worker — image-error retry classification (Task #777) and
 * pre-flight image sweep end-to-end verification (Task #779).
 *
 * - image_not_found / image_forbidden are confirmed-permanent: the post is
 *   marked publish_failed immediately (no retry), with the typed code
 *   stamped in imageIssue so the UI shows the distinct image badge.
 * - image_fetch_failed / image_upload_failed are transient: they retry on
 *   the FAST image backoff (minutes, not hours), and imageIssue is stamped.
 * - successful publishes clear imageIssue.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const state = vi.hoisted(() => ({
  candidates: [] as any[],
  accountRow: {} as any,
  tenantRow: { plan: "pro", socialPostingJitterEnabled: false },
  updates: [] as any[],
  inserts: [] as any[],
  publishResult: { success: true } as any,
}));

vi.mock("../../db", () => ({
  db: {
    select: (fields?: any) => {
      const result =
        fields && "post" in fields
          ? state.candidates
          : fields
            ? [state.tenantRow]
            : [{ ...state.accountRow }];
      const c: any = {};
      for (const m of ["from", "innerJoin", "leftJoin", "where"]) c[m] = () => c;
      c.limit = () => Promise.resolve(result);
      c.then = (res: any, rej: any) => Promise.resolve(result).then(res, rej);
      return c;
    },
    update: () => ({
      set: (payload: any) => ({
        where: async () => {
          state.updates.push(payload);
          return [];
        },
      }),
    }),
    insert: (table: any) => ({
      values: async (payload: any) => {
        state.inserts.push(payload);
        return [];
      },
    }),
  },
}));

vi.mock("../../utils/encryption", () => ({
  encryptSecret: (s: string) => `enc:${s}`,
  decryptSecret: (s: string) => s.replace(/^enc:/, ""),
}));

vi.mock("../plan-policy", () => ({
  checkFeatureAccessAsync: async () => ({ allowed: true }),
}));

const preflight = vi.hoisted(() => ({
  /** url → result of checkImageResolvable */
  results: new Map<string, any>(),
}));

vi.mock("../social-publishers/image-retrieval", () => ({
  checkImageResolvable: async (url: string) =>
    preflight.results.get(url) ?? { ok: true },
}));

vi.mock("../social-publishers", () => ({
  getPublisher: () => ({
    platform: "linkedin",
    supported: true,
    publish: async () => state.publishResult,
  }),
}));

import { tickMarketingPublishWorker, preflightImageCheck } from "../marketing-publish-worker";

const postUpdate = () =>
  state.updates.find(u => "status" in u && ("publishError" in u || "publishedAt" in u));

beforeEach(() => {
  state.updates.length = 0;
  state.inserts.length = 0;
  state.accountRow = {
    id: "acct-1",
    tenantDomain: "t.example.com",
    marketId: null,
    platform: "linkedin",
    status: "active",
    publishingPaused: false,
    encryptedAccessToken: "enc:tok",
    encryptedRefreshToken: "enc:ref",
    tokenExpiresAt: new Date(Date.now() + 3600_000),
  };
  state.candidates = [{
    post: {
      id: "post-1",
      tenantDomain: "t.example.com",
      platform: "linkedin",
      status: "approved",
      scheduledDate: new Date(Date.now() - 60_000),
      publishNotBefore: new Date(Date.now() - 1000),
      publishAttemptCount: 0,
      campaignId: null,
      deliveryMode: null,
      exactSchedule: true,
    },
    account: state.accountRow,
  }];
});

afterEach(() => {
  // reset per-tenant daily counter state between tests by using fresh tenants
});

let tenantN = 0;
const freshTenant = () => {
  tenantN += 1;
  const d = `t${tenantN}.example.com`;
  state.accountRow.tenantDomain = d;
  state.candidates[0].post.tenantDomain = d;
  return d;
};

describe("image-error retry classification", () => {
  it("marks image_not_found as publish_failed immediately (no retry) with imageIssue stamped", async () => {
    freshTenant();
    state.publishResult = {
      success: false,
      errorCode: "image_not_found",
      errorMessage: "The image no longer exists — replace it.",
    };
    await tickMarketingPublishWorker();
    const u = postUpdate();
    expect(u.status).toBe("publish_failed");
    expect(u.publishNextAttemptAt).toBeNull();
    expect(u.imageIssue).toBe("image_not_found");
  });

  it("marks image_forbidden as permanent too", async () => {
    freshTenant();
    state.publishResult = {
      success: false,
      errorCode: "image_forbidden",
      errorMessage: "Auth-gated image path.",
    };
    await tickMarketingPublishWorker();
    const u = postUpdate();
    expect(u.status).toBe("publish_failed");
    expect(u.imageIssue).toBe("image_forbidden");
  });

  it("retries image_fetch_failed on the fast image backoff (2 min, not 5)", async () => {
    freshTenant();
    state.publishResult = {
      success: false,
      errorCode: "image_fetch_failed",
      errorMessage: "Transient storage blip.",
    };
    const before = Date.now();
    await tickMarketingPublishWorker();
    const u = postUpdate();
    expect(u.status).toBe("approved"); // re-queued
    expect(u.imageIssue).toBe("image_fetch_failed");
    const deltaMin = (u.publishNextAttemptAt.getTime() - before) / 60_000;
    expect(deltaMin).toBeGreaterThan(1.5);
    expect(deltaMin).toBeLessThan(3); // fast backoff (2 min), not the 5-min default
  });

  it("keeps the standard backoff for non-image transient errors", async () => {
    freshTenant();
    state.publishResult = {
      success: false,
      errorCode: "http_500",
      errorMessage: "LinkedIn 500.",
    };
    const before = Date.now();
    await tickMarketingPublishWorker();
    const u = postUpdate();
    expect(u.status).toBe("approved");
    expect(u.imageIssue).toBeUndefined();
    const deltaMin = (u.publishNextAttemptAt.getTime() - before) / 60_000;
    expect(deltaMin).toBeGreaterThan(4); // default 5-min first backoff
  });

  it("clears imageIssue on a successful publish", async () => {
    freshTenant();
    state.publishResult = { success: true, publishedUrl: "https://l.example.com/1" };
    await tickMarketingPublishWorker();
    const u = postUpdate();
    expect(u.status).toBe("published");
    expect(u.imageIssue).toBeNull();
  });
});

describe("preflightImageCheck", () => {
  beforeEach(() => {
    preflight.results.clear();
    state.candidates[0].post.scheduledDate = new Date(Date.now() + 3_600_000); // due in 1h
    state.candidates[0].post.imageCheckedAt = null;
    state.candidates[0].post.imageIssue = null;
  });

  const preflightUpdate = () => state.updates.find(u => "imageCheckedAt" in u);

  it("flags an Instagram post with no override image as image_required (lead image doesn't count)", async () => {
    state.candidates[0].post.platform = "instagram";
    state.candidates[0].post.overrideImageUrl = null;
    // A lead image alone must NOT pass — Instagram's publisher never uses it.
    state.candidates[0].post.leadImageUrl = "/public-objects/lead.png";
    const res = await preflightImageCheck();
    expect(res.flagged).toBe(1);
    expect(preflightUpdate().imageIssue).toBe("image_required");
  });

  it("passes an Instagram post whose override image resolves", async () => {
    state.candidates[0].post.platform = "instagram";
    state.candidates[0].post.overrideImageUrl = "/public-objects/ok.png";
    const res = await preflightImageCheck();
    expect(res.flagged).toBe(0);
    expect(preflightUpdate().imageIssue).toBeUndefined(); // not touched — no prior issue
  });

  it("flags a post whose image is permanently missing", async () => {
    state.candidates[0].post.overrideImageUrl = "/public-objects/gone.png";
    preflight.results.set("/public-objects/gone.png", { ok: false, code: "image_not_found", message: "missing" });
    const res = await preflightImageCheck();
    expect(res.flagged).toBe(1);
    expect(preflightUpdate().imageIssue).toBe("image_not_found");
  });

  it("skips flagging on transient preflight errors", async () => {
    state.candidates[0].post.overrideImageUrl = "/public-objects/a.png";
    preflight.results.set("/public-objects/a.png", { ok: false, code: "image_fetch_failed", transient: true });
    const res = await preflightImageCheck();
    expect(res.flagged).toBe(0);
    expect(preflightUpdate()).toBeUndefined(); // nothing stamped — recheck next sweep
  });

  it("clears a previously flagged issue once the image resolves again", async () => {
    state.candidates[0].post.overrideImageUrl = "/public-objects/fixed.png";
    state.candidates[0].post.imageIssue = "image_not_found";
    const res = await preflightImageCheck();
    expect(res.cleared).toBe(1);
    expect(preflightUpdate().imageIssue).toBeNull();
  });

  it("checks every carousel slide", async () => {
    state.candidates[0].post.postFormat = "carousel";
    state.candidates[0].post.carouselSlides = [
      { imageUrl: "/public-objects/s1.png" },
      { imageUrl: "/public-objects/s2.png" },
    ];
    preflight.results.set("/public-objects/s2.png", { ok: false, code: "image_not_found", message: "missing" });
    const res = await preflightImageCheck();
    expect(res.flagged).toBe(1);
    expect(preflightUpdate().imageIssue).toBe("image_not_found");
  });

  it("does not write a duplicate audit entry when the same issue is already flagged on recheck", async () => {
    // Simulate a post that was already flagged with image_not_found.
    state.candidates[0].post.overrideImageUrl = "/public-objects/still-gone.png";
    state.candidates[0].post.imageIssue = "image_not_found"; // already flagged same code
    preflight.results.set("/public-objects/still-gone.png", {
      ok: false,
      code: "image_not_found",
      message: "still missing",
    });

    const res = await preflightImageCheck();

    // The db update is still written (stamps imageCheckedAt), but...
    expect(preflightUpdate().imageIssue).toBe("image_not_found");
    // ...no new audit-log insert should be produced for this recheck.
    const auditInserts = state.inserts.filter(
      (i: any) => i.action === "image_preflight",
    );
    expect(auditInserts).toHaveLength(0);
    // flagged counter stays 0 — only transitions count.
    expect(res.flagged).toBe(0);
  });
});
