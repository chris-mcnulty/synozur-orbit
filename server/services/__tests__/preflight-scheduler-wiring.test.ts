/**
 * Scheduler wiring verification for preflightImageCheck (Task #793).
 *
 * Confirms that:
 * 1. preflightImageCheck is imported and invoked from startScheduledJobs().
 * 2. The invocation interval is <= PREFLIGHT_RECHECK_MINUTES (30 min), so
 *    operators always get early image warnings inside the recheck window.
 *
 * Strategy: spy on globalThis.setTimeout / setInterval BEFORE calling
 * startScheduledJobs() to capture every (callback, delay) pair the scheduler
 * registers. Then invoke only the publish-worker callback in isolation —
 * no broad timer advancement, no unrelated scheduled-job side-effects.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Silence all heavy service imports that scheduled-jobs.ts pulls in.
// ---------------------------------------------------------------------------
vi.mock("../../storage", () => ({ storage: new Proxy({}, { get: () => async () => null }) }));
vi.mock("../web-crawler", () => ({
  crawlCompetitorWebsite: async () => {},
  getCombinedContent: async () => ({}),
  buildCrawlData: async () => ({}),
}));
vi.mock("../visual-capture", () => ({ captureVisualAssets: async () => {} }));
vi.mock("../social-monitoring", () => ({
  monitorCompetitorSocialMedia: async () => {},
  monitorCompanyProfileSocialMedia: async () => {},
  monitorProductSocialMedia: async () => {},
}));
vi.mock("../website-monitoring", () => ({
  monitorCompetitorWebsite: async () => {},
  monitorCompanyProfileWebsite: async () => {},
  monitorProductWebsite: async () => {},
}));
vi.mock("../pricing-intelligence", () => ({
  monitorCompetitorPricing: async () => {},
  monitorBaselinePricing: async () => {},
}));
vi.mock("../../ai-service", () => ({ analyzeCompetitorWebsite: async () => ({}) }));
vi.mock("../trial-service", () => ({ processTrialReminders: async () => {} }));
vi.mock("../email-service", () => ({
  sendWeeklyDigestEmail: async () => {},
  sendScheduledBriefingEmail: async () => {},
}));
vi.mock("../intelligence-briefing-service", () => ({ generateBriefing: async () => ({}) }));
vi.mock("../notifications", () => ({ notifications: { send: async () => {} } }));
vi.mock("../job-queue", () => ({ enqueueCrawl: async () => {}, enqueueMonitor: async () => {} }));
vi.mock("../crawl-db", () => ({
  crawlOps: new Proxy({}, { get: () => async () => null }),
}));
vi.mock("../plan-policy", () => ({ checkFeatureAccessAsync: async () => ({ allowed: true }) }));
vi.mock("../asset-suggestion-service", () => ({ identifySuggestedAssets: async () => {} }));
vi.mock("../planner-graph-client", () => ({
  getValidGraphToken: async () => "tok",
  renewGraphSubscription: async () => {},
}));
vi.mock("../email-campaign-sender", () => ({ tickEmailSendWorker: async () => {} }));
vi.mock("../email-ab-test", () => ({ tickAbTestEvaluationWorker: async () => {} }));
vi.mock("../hubspot-email-backfill", () => ({ tickHubspotEmailSyncBackfill: async () => {} }));
vi.mock("../marketing-workflow-service", () => ({
  tickWorkflowEngine: async () => {},
  sweepAllTenantWorkflowTriggers: async () => {},
  evaluateSegmentTriggers: async () => {},
}));
vi.mock("../../routes/seo", () => ({ refreshSeoForContext: async () => {} }));
vi.mock("../../db", () => ({
  db: {
    execute: async () => [],
    select: () => {
      const chain: any = {};
      for (const m of ["from", "innerJoin", "leftJoin", "where", "orderBy", "limit", "groupBy"]) {
        chain[m] = () => chain;
      }
      chain.then = (res: any) => res([]);
      chain.limit = async () => [];
      return chain;
    },
    update: () => ({ set: () => ({ where: async () => [] }) }),
    insert: () => ({ values: async () => [] }),
  },
  crawlDb: {
    execute: async () => [],
    select: () => {
      const chain: any = {};
      for (const m of ["from", "innerJoin", "leftJoin", "where", "orderBy", "limit", "groupBy"]) {
        chain[m] = () => chain;
      }
      chain.then = (res: any) => res([]);
      chain.limit = async () => [];
      return chain;
    },
    update: () => ({ set: () => ({ where: async () => [] }) }),
    insert: () => ({ values: async () => [] }),
  },
}));

// Provide a permissive schema mock — return empty proxies for any table name
// so that any sql reference in the scheduler doesn't throw.
vi.mock("@shared/schema", () =>
  new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "__esModule") return true;
        return {};
      },
    },
  ),
);

vi.mock("drizzle-orm", () => {
  const noop = () => ({});
  const tagged = new Proxy(noop, { get: () => noop });
  return {
    eq: noop, and: noop, or: noop, desc: noop, asc: noop,
    isNull: noop, isNotNull: noop, lt: noop, lte: noop, gt: noop, gte: noop,
    ne: noop, inArray: noop, notInArray: noop, sql: tagged,
    count: noop, sum: noop, avg: noop, max: noop, min: noop,
    getTableColumns: () => ({}),
  };
});

// ---------------------------------------------------------------------------
// The four functions scheduled-jobs imports from marketing-publish-worker.
// Spy on preflightImageCheck; stub the rest as no-ops.
// ---------------------------------------------------------------------------
const preflightSpy = vi.fn().mockResolvedValue({ checked: 0, flagged: 0, cleared: 0 });
const publishTickSpy = vi.fn().mockResolvedValue(undefined);
const sweepSpy = vi.fn().mockResolvedValue(undefined);
const linkedInHealthSpy = vi.fn().mockResolvedValue({ checked: 0, flagged: 0 });

vi.mock("../marketing-publish-worker", () => ({
  tickMarketingPublishWorker: (...args: any[]) => publishTickSpy(...args),
  sweepMissedPosts: (...args: any[]) => sweepSpy(...args),
  preflightImageCheck: (...args: any[]) => preflightSpy(...args),
  tickLinkedInAdminHealthCheck: (...args: any[]) => linkedInHealthSpy(...args),
}));

// Import after all mocks are registered.
import { startScheduledJobs, stopScheduledJobs } from "../scheduled-jobs";

// ---------------------------------------------------------------------------
// The constant from marketing-publish-worker.ts that defines the recheck window.
// The scheduler must invoke preflightImageCheck at an interval <= this value.
// ---------------------------------------------------------------------------
const PREFLIGHT_RECHECK_MINUTES = 30;
const PREFLIGHT_RECHECK_MS = PREFLIGHT_RECHECK_MINUTES * 60 * 1000;

// ---------------------------------------------------------------------------
// Helper: capture every (callback, delay) that startScheduledJobs registers
// via setTimeout or setInterval, then run startScheduledJobs.
// ---------------------------------------------------------------------------
interface TimerEntry {
  kind: "timeout" | "interval";
  callback: () => void;
  delay: number;
}

function captureTimers(): { entries: TimerEntry[]; restore: () => void } {
  const entries: TimerEntry[] = [];
  const origSetTimeout = globalThis.setTimeout;
  const origSetInterval = globalThis.setInterval;

  // @ts-ignore — widening for capture
  globalThis.setTimeout = (cb: () => void, delay = 0, ...args: any[]) => {
    entries.push({ kind: "timeout", callback: () => cb(...args), delay });
    return origSetTimeout(cb, delay, ...args);
  };
  // @ts-ignore
  globalThis.setInterval = (cb: () => void, delay = 0, ...args: any[]) => {
    entries.push({ kind: "interval", callback: () => cb(...args), delay });
    return origSetInterval(cb, delay, ...args);
  };

  return {
    entries,
    restore() {
      globalThis.setTimeout = origSetTimeout;
      globalThis.setInterval = origSetInterval;
    },
  };
}

describe("preflight image check — scheduler wiring", () => {
  let entries: TimerEntry[];
  let restoreTimers: () => void;

  beforeEach(() => {
    preflightSpy.mockClear();
    publishTickSpy.mockClear();
    sweepSpy.mockClear();
    linkedInHealthSpy.mockClear();

    const captured = captureTimers();
    entries = captured.entries;
    restoreTimers = captured.restore;

    startScheduledJobs();

    // Restore globals immediately — we have the captured entries we need.
    restoreTimers();
  });

  afterEach(() => {
    stopScheduledJobs();
  });

  // ---------------------------------------------------------------------------
  // Find the publish-worker startup timeout (3.5 min delay) and invoke it.
  // This both calls runPublishTick() once (immediate first tick) AND registers
  // the recurring setInterval. We then find that interval to check its delay.
  //
  // Because the inner setInterval is registered DURING the timeout callback,
  // we need a second capture pass around the timeout invocation.
  // ---------------------------------------------------------------------------
  function invokePublishWorkerStartup(): { intervalDelay: number } {
    // The publish-worker is behind a 3.5-minute startup setTimeout.
    const STARTUP_DELAY_MS = 3.5 * 60 * 1000;
    const startupTimeout = entries.find(
      e => e.kind === "timeout" && Math.abs(e.delay - STARTUP_DELAY_MS) < 5_000,
    );
    expect(
      startupTimeout,
      `Expected a setTimeout with ~3.5-minute delay in startScheduledJobs(); ` +
      `found delays: ${entries.filter(e => e.kind === "timeout").map(e => e.delay).join(", ")}`,
    ).toBeDefined();

    // Capture setInterval calls made inside the startup callback.
    const innerEntries: TimerEntry[] = [];
    const origSetInterval = globalThis.setInterval;
    // @ts-ignore
    globalThis.setInterval = (cb: () => void, delay = 0, ...args: any[]) => {
      innerEntries.push({ kind: "interval", callback: () => cb(...args), delay });
      // Return a dummy handle — don't actually schedule it.
      return 0 as unknown as ReturnType<typeof setInterval>;
    };

    startupTimeout!.callback();

    globalThis.setInterval = origSetInterval;

    const intervalEntry = innerEntries[0];
    expect(
      intervalEntry,
      "Expected the publish-worker startup callback to register a setInterval for recurring ticks.",
    ).toBeDefined();

    return { intervalDelay: intervalEntry!.delay };
  }

  it("calls preflightImageCheck on the first publish-worker tick (at startup)", () => {
    invokePublishWorkerStartup();
    // The startup callback calls runPublishTick() once immediately.
    expect(preflightSpy).toHaveBeenCalledTimes(1);
  });

  it("recurring publish-worker interval is <= PREFLIGHT_RECHECK_MINUTES (30 min)", () => {
    const { intervalDelay } = invokePublishWorkerStartup();
    expect(intervalDelay).toBeLessThanOrEqual(PREFLIGHT_RECHECK_MS);
    console.log(
      `[Preflight wiring] Publish-worker interval: ${intervalDelay / 60_000} min ` +
      `(<= ${PREFLIGHT_RECHECK_MINUTES} min limit ✓)`,
    );
  });

  it("preflightImageCheck fires on the same tick as tickMarketingPublishWorker", () => {
    invokePublishWorkerStartup();
    // Both are called once on the immediate first tick.
    expect(preflightSpy).toHaveBeenCalledTimes(1);
    expect(publishTickSpy).toHaveBeenCalledTimes(1);
  });
});
