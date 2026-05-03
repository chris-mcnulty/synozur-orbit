/**
 * Concurrency primitives for the regeneration pipeline.
 *
 * Two pieces:
 *
 * 1. `runWithConcurrency` — a tiny bounded promise pool for fanning out
 *    work over a list of items. Useful for distributing per-item work
 *    (one task per competitor, per marketing plan, etc.). The worker is
 *    responsible for catching its own errors so one failed item does not
 *    abort the others.
 *
 * 2. `aiLimiter.anthropic` / `aiLimiter.openai` — process-wide semaphores
 *    that bound the *total* in-flight AI calls per provider. Every AI
 *    provider call inside the regeneration pipeline must go through the
 *    matching limiter so the per-provider cap is enforced GLOBALLY,
 *    across all parallel lanes and per-item pools — not just within a
 *    single pool invocation.
 */

class Semaphore {
  private inFlight = 0;
  private waiters: Array<() => void> = [];

  constructor(private readonly max: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.inFlight < this.max) {
      this.inFlight++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.waiters.push(() => {
        this.inFlight++;
        resolve();
      });
    });
  }

  private release(): void {
    this.inFlight--;
    const next = this.waiters.shift();
    if (next) next();
  }
}

export async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>
): Promise<void> {
  if (items.length === 0) return;
  const limit = Math.min(Math.max(1, concurrency), items.length);
  let nextIndex = 0;
  const runners: Promise<void>[] = [];
  for (let w = 0; w < limit; w++) {
    runners.push(
      (async () => {
        while (true) {
          const i = nextIndex++;
          if (i >= items.length) return;
          await worker(items[i], i);
        }
      })()
    );
  }
  await Promise.all(runners);
}

/**
 * Run a fixed set of independent "lanes" (e.g. battlecards / GTM plan /
 * messaging framework / marketing tasks) in parallel, with these
 * guarantees:
 *
 *   1. Every lane runs — a thrown lane does not abort the others. Each
 *      lane is wrapped in its own try/catch so `Promise.all` cannot
 *      reject early.
 *   2. After every lane settles (success or failure), the shared
 *      `progress.stepsCompleted` counter is advanced by the same
 *      formula the regeneration pipeline uses:
 *
 *          stepsCompleted = min(baseStep + floor(done * stepSpan / N), baseStep + stepSpan)
 *
 *      where `done` is the number of lanes that have finished and `N`
 *      is `lanes.length`. This is what guarantees the counter lands on
 *      `baseStep + stepSpan` once all lanes complete (e.g. 3 + 3 = 6
 *      across the four deliverable lanes).
 *   3. Lanes start concurrently — they are dispatched before any
 *      `await` so they make progress in parallel.
 *
 * `onLaneSettled` is an optional hook, primarily useful in tests, that
 * fires after each lane finishes with `(label, ok)` where `ok` is
 * `false` if the lane threw.
 */
export async function runLanesInParallel(
  lanes: Array<{ label: string; run: () => Promise<void> }>,
  progress: { stepsCompleted: number },
  options: {
    baseStep?: number;
    stepSpan?: number;
    onLaneSettled?: (label: string, ok: boolean) => void;
  } = {}
): Promise<void> {
  const baseStep = options.baseStep ?? 3;
  const stepSpan = options.stepSpan ?? 3;
  const total = lanes.length;
  if (total === 0) return;

  let done = 0;
  const wrapped = lanes.map(({ label, run }) =>
    (async () => {
      let ok = true;
      try {
        await run();
      } catch (err) {
        ok = false;
        console.error(`[lane] ${label} crashed:`, err);
      } finally {
        done++;
        progress.stepsCompleted = Math.min(
          baseStep + Math.floor((done * stepSpan) / total),
          baseStep + stepSpan,
        );
        options.onLaneSettled?.(label, ok);
      }
    })()
  );
  await Promise.all(wrapped);
}

/**
 * Conservative per-provider concurrency caps. Tuned to keep wall-clock
 * time well below the serial baseline while staying inside typical
 * provider rate limits.
 */
export const AI_CONCURRENCY = {
  anthropic: 3,
  openai: 3,
} as const;

/**
 * Process-wide per-provider limiters. Every AI call in the regeneration
 * pipeline should be wrapped in `aiLimiter.anthropic.run(...)` or
 * `aiLimiter.openai.run(...)` so the cap is shared across all parallel
 * lanes (e.g. battlecards + messaging + marketing tasks) and across the
 * inner `runWithConcurrency` per-item pools they use.
 */
export const aiLimiter = {
  anthropic: new Semaphore(AI_CONCURRENCY.anthropic),
  openai: new Semaphore(AI_CONCURRENCY.openai),
};
