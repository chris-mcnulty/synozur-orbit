import { strict as assert } from "node:assert";
import { afterAll, describe, it, vi } from "vitest";
import {
  _runFullHubSpotContactRefreshWithDeps,
  resumeFullHubSpotContactRefreshes,
  runFullHubSpotContactRefresh,
  type FullHubSpotContact,
  type FullHubSpotRefreshDeps,
} from "../hubspot-service";

vi.mock("../hubspot-integration", () => ({
  getTenantClient: vi.fn(),
  withHubspotRetry: vi.fn(async (fn: () => unknown) => fn()),
  isHubspotRateLimitError: vi.fn(() => false),
}));

function contact(id: string): FullHubSpotContact {
  return { id, properties: { email: `${id}@example.com` } };
}

describe("_runFullHubSpotContactRefreshWithDeps", () => {
  it("pages through the complete HubSpot result set and reports final counts", async () => {
    const listPage = vi.fn()
      .mockResolvedValueOnce({ contacts: [contact("one"), contact("two")], nextAfter: "cursor-2" })
      .mockResolvedValueOnce({ contacts: [contact("three")], nextAfter: null });
    const progress: number[] = [];
    const deps: FullHubSpotRefreshDeps = {
      listPage,
      mergeContact: vi.fn()
        .mockResolvedValueOnce("created")
        .mockResolvedValueOnce("updated")
        .mockResolvedValueOnce("skipped"),
      onProgress: (counts) => progress.push(counts.processed),
      pause: async () => {},
    };

    const result = await _runFullHubSpotContactRefreshWithDeps(deps);

    assert.deepEqual(result, {
      pages: 2,
      processed: 3,
      created: 1,
      updated: 1,
      skipped: 1,
      failed: 0,
      rateLimited: 0,
    });
    assert.deepEqual(listPage.mock.calls.map((call) => call[0]), [null, "cursor-2"]);
    assert.deepEqual(progress, [2, 3], "progress is saved after each HubSpot page");
  });

  it("records failed records but continues refreshing the remaining page", async () => {
    const mergeContact = vi.fn()
      .mockResolvedValueOnce("created")
      .mockRejectedValueOnce(new Error("duplicate local identifiers"))
      .mockResolvedValueOnce("updated");
    const deps: FullHubSpotRefreshDeps = {
      listPage: vi.fn().mockResolvedValue({
        contacts: [contact("one"), contact("conflict"), contact("three")],
        nextAfter: null,
      }),
      mergeContact,
      pause: async () => {},
    };

    const result = await _runFullHubSpotContactRefreshWithDeps(deps);

    assert.equal(result.processed, 3);
    assert.equal(result.created, 1);
    assert.equal(result.updated, 1);
    assert.equal(result.failed, 1);
    assert.equal(mergeContact.mock.calls.length, 3, "a bad contact cannot abandon the rest of its page");
  });

  it("stops before another HubSpot page when the queued job is cancelled", async () => {
    const controller = new AbortController();
    const listPage = vi.fn(async () => {
      controller.abort();
      return { contacts: [contact("one")], nextAfter: "cursor-2" };
    });
    const deps: FullHubSpotRefreshDeps = {
      listPage,
      mergeContact: vi.fn().mockResolvedValue("created"),
      pause: async () => {},
      signal: controller.signal,
    };

    await assert.rejects(
      () => _runFullHubSpotContactRefreshWithDeps(deps),
      /cancelled before completion/,
    );
    assert.equal(listPage.mock.calls.length, 1, "a cancelled worker must not request another page");
  });

  it("resumes from a saved HubSpot cursor without resetting prior progress", async () => {
    const listPage = vi.fn().mockResolvedValue({
      contacts: [contact("resumed")],
      nextAfter: null,
    });
    const progress: Array<{ pages: number; processed: number; created: number; updated: number; nextAfter: string | null }> = [];

    const result = await _runFullHubSpotContactRefreshWithDeps({
      listPage,
      mergeContact: vi.fn().mockResolvedValue("updated"),
      onProgress: (counts, nextAfter) => progress.push({
        pages: counts.pages,
        processed: counts.processed,
        created: counts.created,
        updated: counts.updated,
        nextAfter,
      }),
      pause: async () => {},
      startAfter: "saved-cursor",
      initialCounts: {
        pages: 4,
        processed: 10,
        created: 6,
        updated: 3,
        skipped: 1,
        failed: 0,
        rateLimited: 0,
      },
    });

    assert.equal(listPage.mock.calls[0][0], "saved-cursor");
    assert.deepEqual(result, {
      pages: 5,
      processed: 11,
      created: 6,
      updated: 4,
      skipped: 1,
      failed: 0,
      rateLimited: 0,
    });
    assert.deepEqual(progress, [{ pages: 5, processed: 11, created: 6, updated: 4, nextAfter: null }]);
  });
});

const hasDb = Boolean(process.env.DATABASE_URL);
const integrationDescribe = hasDb ? describe : describe.skip;
const INTEGRATION_TENANT = `hubspot-refresh-itest-${Date.now()}.example.com`;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

async function waitForRefreshStatus(jobId: string, status: string): Promise<any> {
  const { db } = await import("../../db");
  const { scheduledJobRuns } = await import("@shared/schema");
  const { eq } = await import("drizzle-orm");

  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const [job] = await db
      .select()
      .from(scheduledJobRuns)
      .where(eq(scheduledJobRuns.id, jobId))
      .limit(1);
    if (job?.status === status) return job;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for HubSpot refresh ${jobId} to become ${status}`);
}

integrationDescribe("full HubSpot contact refresh recovery (integration)", () => {
  afterAll(async () => {
    const { db } = await import("../../db");
    const { marketingContacts, scheduledJobRuns } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");
    await db.delete(marketingContacts).where(eq(marketingContacts.tenantDomain, INTEGRATION_TENANT));
    await db.delete(scheduledJobRuns).where(eq(scheduledJobRuns.tenantDomain, INTEGRATION_TENANT));
  });

  it("resumes a checkpoint after startup recovery and fences the old worker lease", async () => {
    const { db } = await import("../../db");
    const { marketingContacts, scheduledJobRuns } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");
    const { getTenantClient } = await import("../hubspot-integration");

    const existingUpdatedId = "hs-refresh-existing-updated";
    const existingSkippedId = "hs-refresh-existing-skipped";
    const [job] = await db
      .insert(scheduledJobRuns)
      .values({
        jobType: "hubspotFullContactRefresh",
        tenantDomain: INTEGRATION_TENANT,
        status: "pending",
        result: {
          scope: "all contacts in the connected HubSpot portal",
          cursor: "saved-cursor",
          workerId: "interrupted-worker",
          pages: 4,
          processed: 10,
          created: 6,
          updated: 2,
          skipped: 1,
          failed: 1,
          rateLimited: 0,
        },
      })
      .returning({ id: scheduledJobRuns.id });

    await db.insert(marketingContacts).values([
      {
        tenantDomain: INTEGRATION_TENANT,
        email: "resumed-updated@example.com",
        hubspotContactId: existingUpdatedId,
        source: "manual",
      },
      {
        tenantDomain: INTEGRATION_TENANT,
        email: "resumed-skipped@example.com",
        hubspotContactId: existingSkippedId,
        source: "manual",
      },
    ]);

    const oldWorkerPageStarted = deferred<void>();
    const releaseOldWorkerPage = deferred<void>();
    const requestedCursors: Array<string | undefined> = [];
    let pageRequest = 0;
    const client = {
      crm: {
        contacts: {
          basicApi: {
            getPage: vi.fn(async (_limit: number, after?: string) => {
              requestedCursors.push(after);
              pageRequest++;
              if (pageRequest === 1) {
                oldWorkerPageStarted.resolve();
                await releaseOldWorkerPage.promise;
                return {
                  results: [{
                    id: "hs-refresh-stale-worker",
                    properties: { email: "stale-worker@example.com" },
                  }],
                  paging: { next: undefined },
                };
              }
              return {
                results: [
                  {
                    id: "hs-refresh-resumed-created",
                    properties: { email: "resumed-created@example.com" },
                  },
                  {
                    id: existingUpdatedId,
                    properties: {
                      email: "resumed-updated@example.com",
                      firstname: "Updated",
                    },
                  },
                  {
                    id: "hs-refresh-resumed-skipped",
                    properties: { email: "resumed-skipped@example.com" },
                  },
                ],
                paging: { next: undefined },
              };
            }),
          },
        },
      },
    };
    vi.mocked(getTenantClient).mockResolvedValue({ client } as any);

    // This worker has already persisted its checkpoint when the process
    // restarts. Holding it before merge lets recovery claim the replacement
    // lease while the old worker is still alive.
    const oldWorker = runFullHubSpotContactRefresh({
      jobId: job.id,
      tenantDomain: INTEGRATION_TENANT,
    });
    await oldWorkerPageStarted.promise;

    const { db: checkpointDb } = await import("../../db");
    const { scheduledJobRuns: checkpointRuns } = await import("@shared/schema");
    const { eq: checkpointEq } = await import("drizzle-orm");
    const [runningBeforeRecovery] = await checkpointDb
      .select({ status: checkpointRuns.status, result: checkpointRuns.result })
      .from(checkpointRuns)
      .where(checkpointEq(checkpointRuns.id, job.id));
    assert.equal(runningBeforeRecovery.status, "running");
    assert.equal((runningBeforeRecovery.result as any).cursor, "saved-cursor");
    assert.deepEqual(
      {
        pages: (runningBeforeRecovery.result as any).pages,
        processed: (runningBeforeRecovery.result as any).processed,
        created: (runningBeforeRecovery.result as any).created,
        updated: (runningBeforeRecovery.result as any).updated,
        skipped: (runningBeforeRecovery.result as any).skipped,
        failed: (runningBeforeRecovery.result as any).failed,
      },
      { pages: 4, processed: 10, created: 6, updated: 2, skipped: 1, failed: 1 },
    );

    await resumeFullHubSpotContactRefreshes();
    const recovered = await waitForRefreshStatus(job.id, "completed");
    releaseOldWorkerPage.resolve();

    await assert.rejects(oldWorker, /lease is no longer active/);
    assert.deepEqual(requestedCursors, ["saved-cursor", "saved-cursor"]);
    assert.deepEqual(
      {
        pages: (recovered.result as any).pages,
        processed: (recovered.result as any).processed,
        created: (recovered.result as any).created,
        updated: (recovered.result as any).updated,
        skipped: (recovered.result as any).skipped,
        failed: (recovered.result as any).failed,
      },
      { pages: 5, processed: 13, created: 7, updated: 3, skipped: 2, failed: 1 },
    );

    const contacts = await db
      .select({ email: marketingContacts.email })
      .from(marketingContacts)
      .where(eq(marketingContacts.tenantDomain, INTEGRATION_TENANT));
    assert.deepEqual(
      contacts.map((row) => row.email).sort(),
      [
        "resumed-created@example.com",
        "resumed-skipped@example.com",
        "resumed-updated@example.com",
      ],
    );
  });
});