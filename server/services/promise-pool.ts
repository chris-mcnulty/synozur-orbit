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
