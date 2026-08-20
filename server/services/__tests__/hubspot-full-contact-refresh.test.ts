import { strict as assert } from "node:assert";
import { describe, it, vi } from "vitest";
import {
  _runFullHubSpotContactRefreshWithDeps,
  type FullHubSpotContact,
  type FullHubSpotRefreshDeps,
} from "../hubspot-service";

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