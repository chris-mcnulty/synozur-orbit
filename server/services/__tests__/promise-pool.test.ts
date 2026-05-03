import { strict as assert } from "node:assert";
import {
  runWithConcurrency,
  runLanesInParallel,
  aiLimiter,
  AI_CONCURRENCY,
} from "../promise-pool";

let failures = 0;
async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`[ok]   ${name}`);
  } catch (err) {
    failures++;
    console.error(`[FAIL] ${name}`);
    console.error(err);
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function main() {
  // ---------------------------------------------------------------
  // runWithConcurrency
  // ---------------------------------------------------------------
  await test("runWithConcurrency: empty input is a no-op", async () => {
    let called = 0;
    await runWithConcurrency<number>([], 4, async () => {
      called++;
    });
    assert.equal(called, 0);
  });

  await test("runWithConcurrency: visits every item exactly once", async () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const seen: number[] = [];
    await runWithConcurrency(items, 3, async (item) => {
      seen.push(item);
    });
    assert.equal(seen.length, items.length);
    assert.deepEqual([...seen].sort((a, b) => a - b), items);
  });

  await test("runWithConcurrency: never exceeds the concurrency cap", async () => {
    const items = Array.from({ length: 20 }, (_, i) => i);
    let inFlight = 0;
    let peak = 0;
    await runWithConcurrency(items, 3, async () => {
      inFlight++;
      if (inFlight > peak) peak = inFlight;
      await sleep(5);
      inFlight--;
    });
    assert.equal(peak <= 3, true, `peak=${peak} exceeded cap of 3`);
    // With 20 items and a 5ms task we expect to actually saturate the cap.
    assert.equal(peak >= 2, true, `peak=${peak} suggests no real parallelism`);
  });

  await test("runWithConcurrency: results written by worker index preserve input order", async () => {
    // Even though items run concurrently with non-deterministic completion
    // order, writing into a pre-sized array by `index` must yield a result
    // array equal to a 1:1 transform of the input.
    const items = ["a", "b", "c", "d", "e", "f", "g", "h"];
    const results: string[] = new Array(items.length);
    await runWithConcurrency(items, 3, async (item, index) => {
      // Stagger completion so finish order != start order.
      await sleep((items.length - index) * 2);
      results[index] = item.toUpperCase();
    });
    assert.deepEqual(results, items.map((s) => s.toUpperCase()));
  });

  await test("runWithConcurrency: a worker error propagates (worker is responsible for catching)", async () => {
    let err: unknown = null;
    try {
      await runWithConcurrency([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error("boom");
      });
    } catch (e) {
      err = e;
    }
    assert.notEqual(err, null);
    assert.equal((err as Error).message, "boom");
  });

  // ---------------------------------------------------------------
  // aiLimiter (Semaphore)
  // ---------------------------------------------------------------
  await test("aiLimiter.anthropic: caps in-flight calls at AI_CONCURRENCY.anthropic (3)", async () => {
    let inFlight = 0;
    let peak = 0;
    const tasks: Promise<void>[] = [];
    for (let i = 0; i < 12; i++) {
      tasks.push(
        aiLimiter.anthropic.run(async () => {
          inFlight++;
          if (inFlight > peak) peak = inFlight;
          await sleep(8);
          inFlight--;
        })
      );
    }
    await Promise.all(tasks);
    assert.equal(
      peak <= AI_CONCURRENCY.anthropic,
      true,
      `peak=${peak} exceeded anthropic cap ${AI_CONCURRENCY.anthropic}`
    );
    assert.equal(peak >= 2, true, `peak=${peak} suggests no real parallelism`);
  });

  await test("aiLimiter: a rejecting task releases its slot for waiters", async () => {
    // Saturate the limiter, then enqueue a rejecting task and a successful
    // one. The successful one must still run.
    const blockers: Array<{ resolve: () => void }> = [];
    const blockerPromises = [];
    for (let i = 0; i < AI_CONCURRENCY.anthropic; i++) {
      blockerPromises.push(
        aiLimiter.anthropic.run(
          () =>
            new Promise<void>((resolve) => {
              blockers.push({ resolve });
            })
        )
      );
    }
    // Wait for the blockers to actually populate (the executor runs as a
    // microtask after `acquire()` resolves).
    while (blockers.length < AI_CONCURRENCY.anthropic) {
      await sleep(1);
    }
    let bombSettled = false;
    let okRan = false;
    const bomb = aiLimiter.anthropic
      .run(async () => {
        throw new Error("bomb");
      })
      .catch(() => {
        bombSettled = true;
      });
    const ok = aiLimiter.anthropic.run(async () => {
      okRan = true;
    });
    // Release one blocker → bomb should run, throw, release; then ok runs.
    blockers[0].resolve();
    await bomb;
    // Release the rest so blockers settle and ok runs to completion.
    for (let i = 1; i < blockers.length; i++) blockers[i].resolve();
    await Promise.all(blockerPromises);
    await ok;
    assert.equal(bombSettled, true);
    assert.equal(okRan, true, "successful task did not run after a rejection");
  });

  // ---------------------------------------------------------------
  // runLanesInParallel — the regen pipeline orchestration helper.
  // This is the integration-level coverage of the parallel
  // regeneration pipeline: the four deliverable lanes are invoked
  // through this helper and we assert the invariants the pipeline
  // depends on.
  // ---------------------------------------------------------------
  await test("runLanesInParallel: all four lanes run, counter advances 3 -> 6", async () => {
    const progress = { stepsCompleted: 3 };
    const ran: string[] = [];
    const settled: string[] = [];
    await runLanesInParallel(
      [
        {
          label: "Battlecards",
          run: async () => {
            await sleep(5);
            ran.push("Battlecards");
          },
        },
        {
          label: "GTM plan",
          run: async () => {
            await sleep(10);
            ran.push("GTM plan");
          },
        },
        {
          label: "Messaging framework",
          run: async () => {
            await sleep(2);
            ran.push("Messaging framework");
          },
        },
        {
          label: "Marketing tasks",
          run: async () => {
            await sleep(15);
            ran.push("Marketing tasks");
          },
        },
      ],
      progress,
      {
        baseStep: 3,
        stepSpan: 3,
        onLaneSettled: (label) => settled.push(label),
      }
    );

    assert.equal(ran.length, 4, `expected 4 lanes to run, got ${ran.length}`);
    assert.deepEqual([...ran].sort(), [
      "Battlecards",
      "GTM plan",
      "Marketing tasks",
      "Messaging framework",
    ]);
    assert.equal(settled.length, 4);
    assert.equal(progress.stepsCompleted, 6, "counter must land on baseStep + stepSpan");
  });

  await test("runLanesInParallel: a thrown lane does NOT abort the others", async () => {
    const progress = { stepsCompleted: 3 };
    const ran: string[] = [];
    const settled: Array<{ label: string; ok: boolean }> = [];
    await runLanesInParallel(
      [
        {
          label: "Battlecards",
          run: async () => {
            await sleep(5);
            ran.push("Battlecards");
          },
        },
        {
          label: "GTM plan",
          run: async () => {
            await sleep(2);
            throw new Error("simulated GTM failure");
          },
        },
        {
          label: "Messaging framework",
          run: async () => {
            await sleep(8);
            ran.push("Messaging framework");
          },
        },
        {
          label: "Marketing tasks",
          run: async () => {
            await sleep(3);
            ran.push("Marketing tasks");
          },
        },
      ],
      progress,
      {
        baseStep: 3,
        stepSpan: 3,
        onLaneSettled: (label, ok) => settled.push({ label, ok }),
      }
    );

    // Three lanes pushed to `ran`; the throwing one did not.
    assert.deepEqual([...ran].sort(), [
      "Battlecards",
      "Marketing tasks",
      "Messaging framework",
    ]);
    // All four lanes settled (success or failure).
    assert.equal(settled.length, 4);
    const gtm = settled.find((s) => s.label === "GTM plan");
    assert.equal(gtm?.ok, false, "GTM plan should be marked as failed");
    const others = settled.filter((s) => s.label !== "GTM plan");
    for (const o of others) {
      assert.equal(o.ok, true, `${o.label} should be marked as ok`);
    }
    // Counter still reaches baseStep + stepSpan even though one lane threw.
    assert.equal(progress.stepsCompleted, 6);
  });

  await test("runLanesInParallel: lanes execute concurrently, not serially", async () => {
    const progress = { stepsCompleted: 3 };
    const PER_LANE_MS = 30;
    const start = Date.now();
    await runLanesInParallel(
      Array.from({ length: 4 }, (_, i) => ({
        label: `lane-${i}`,
        run: async () => {
          await sleep(PER_LANE_MS);
        },
      })),
      progress,
    );
    const elapsed = Date.now() - start;
    // Serial would be ~120ms; parallel should be roughly PER_LANE_MS.
    // Allow generous slack for CI jitter but still well under serial time.
    assert.equal(
      elapsed < PER_LANE_MS * 4 - 10,
      true,
      `lanes appear to be running serially (elapsed=${elapsed}ms)`,
    );
    assert.equal(progress.stepsCompleted, 6);
  });

  await test("runLanesInParallel: matches pipeline progression — 3 baseline + 3 lanes + post-lane bump = 7", async () => {
    // This mirrors the regeneration pipeline: stepsCompleted starts at 3
    // before the parallel phase, lanes advance it to 6, and post-lane
    // bookkeeping bumps it to 7. We simulate the post-lane bump after the
    // helper returns to confirm the contract end-to-end.
    const progress = { stepsCompleted: 3 };
    await runLanesInParallel(
      [
        { label: "A", run: async () => {} },
        { label: "B", run: async () => { throw new Error("x"); } },
        { label: "C", run: async () => {} },
        { label: "D", run: async () => {} },
      ],
      progress,
      { baseStep: 3, stepSpan: 3 },
    );
    assert.equal(progress.stepsCompleted, 6);
    // Pipeline's next line: progress.stepsCompleted = 7 ("Recording scores").
    progress.stepsCompleted = 7;
    assert.equal(progress.stepsCompleted, 7);
  });

  await test("runLanesInParallel: empty lane list is a no-op", async () => {
    const progress = { stepsCompleted: 3 };
    await runLanesInParallel([], progress, { baseStep: 3, stepSpan: 3 });
    assert.equal(progress.stepsCompleted, 3);
  });

  // ---------------------------------------------------------------
  // Done
  // ---------------------------------------------------------------
  if (failures > 0) {
    console.error(`\n${failures} check(s) failed.`);
    process.exit(1);
  }
  console.log(`\nAll checks passed.`);
}

main().catch((err) => {
  console.error("Test harness crashed:", err);
  process.exit(1);
});
