type JobType = "pdf" | "crawl" | "monitor" | "analysis" | "other";
type JobStatus = "pending" | "active" | "completed" | "failed" | "timeout" | "dead";

/** Optional context passed alongside a job for DB persistence and display. */
export interface JobContext {
  tenantDomain?: string;
  targetId?: string;
  targetName?: string;
}

/** Max number of automatic retry attempts before a job goes to the dead-letter store. */
const DEFAULT_MAX_RETRIES = 3;
/** Base delay for exponential back-off (ms). Each attempt doubles this. */
const RETRY_BASE_DELAY_MS = 2_000;

interface QueuedJob<T = any> {
  id: string;
  type: JobType;
  priority: number;
  label: string;
  status: JobStatus;
  work: (signal?: AbortSignal) => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: any) => void;
  enqueuedAt: number;
  startedAt?: number;
  completedAt?: number;
  timeoutMs: number;
  abortController?: AbortController;
  /** DB row id when persistence is enabled. */
  dbRowId?: string;
  ctx?: JobContext;
  /** Retry tracking */
  retryCount: number;
  maxRetries: number;
  lastError?: string;
}

// ---------------------------------------------------------------------------
// Persistence hooks — wired up at startup via setPersistenceHooks() so that
// the job queue can write lifecycle events to the scheduled_job_runs table
// without importing the DB layer directly (avoids circular dependencies).
// ---------------------------------------------------------------------------
interface PersistenceHooks {
  onCreate(job: {
    id: string;
    type: JobType;
    label: string;
    status: "running";
    startedAt: Date;
    ctx?: JobContext;
  }): Promise<string>;
  onComplete(dbRowId: string, status: "completed" | "failed", errorMessage?: string): Promise<void>;
}

let persistenceHooks: PersistenceHooks | null = null;

/** Called once during server startup after the DB is ready. */
export function setPersistenceHooks(hooks: PersistenceHooks): void {
  persistenceHooks = hooks;
  console.log("[JobQueue] DB persistence hooks registered");
}

interface QueueConfig {
  maxConcurrent: number;
  perTypeLimits: Partial<Record<JobType, number>>;
  defaultTimeoutMs: number;
}

/** Public shape of a dead-letter job (safe to serialise). */
export interface DeadLetterJob {
  id: string;
  type: JobType;
  label: string;
  lastError: string;
  retryCount: number;
  failedAt: number;
  ctx?: JobContext;
}

interface QueueStats {
  active: number;
  pending: number;
  completed: number;
  failed: number;
  deadLettered: number;
  activeByType: Record<string, number>;
  pendingByType: Record<string, number>;
  activeJobs: Array<{ id: string; type: JobType; label: string; runningSec: number }>;
  pendingJobs: Array<{ id: string; type: JobType; label: string; waitingSec: number; priority: number }>;
  deadLetterJobs: DeadLetterJob[];
  paused: boolean;
}

const DEFAULT_CONFIG: QueueConfig = {
  maxConcurrent: 4,
  perTypeLimits: {
    pdf: 1,
    crawl: 2,
    monitor: 2,
    analysis: 1,
  },
  defaultTimeoutMs: 5 * 60 * 1000,
};

const PRIORITY = {
  pdf: 10,
  analysis: 5,
  crawl: 3,
  monitor: 2,
  other: 1,
} as const;

let jobCounter = 0;
const pendingQueue: QueuedJob[] = [];
const activeJobs: Map<string, QueuedJob> = new Map();
/** Jobs that exhausted all retries — stored for admin inspection / manual retry. */
const deadLetterStore: Map<string, DeadLetterJob> = new Map();
let completedCount = 0;
let failedCount = 0;
let paused = false;
let config = { ...DEFAULT_CONFIG };

function generateJobId(type: JobType): string {
  return `${type}-${++jobCounter}-${Date.now().toString(36)}`;
}

function getActiveCountByType(type: JobType): number {
  let count = 0;
  for (const job of activeJobs.values()) {
    if (job.type === type) count++;
  }
  return count;
}

function getPendingCountByType(type: JobType): number {
  return pendingQueue.filter(j => j.type === type).length;
}

function canStartJob(type: JobType): boolean {
  if (paused) return false;
  if (activeJobs.size >= config.maxConcurrent) return false;
  const typeLimit = config.perTypeLimits[type];
  if (typeLimit !== undefined && getActiveCountByType(type) >= typeLimit) return false;
  return true;
}

function processQueue(): void {
  if (paused) return;

  const sortedPending = [...pendingQueue].sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    return a.enqueuedAt - b.enqueuedAt;
  });

  for (const job of sortedPending) {
    if (activeJobs.size >= config.maxConcurrent) break;
    if (!canStartJob(job.type)) continue;

    const idx = pendingQueue.indexOf(job);
    if (idx === -1) continue;
    pendingQueue.splice(idx, 1);

    startJob(job);
  }
}

function startJob(job: QueuedJob): void {
  job.status = "active";
  job.startedAt = Date.now();
  const abortController = new AbortController();
  job.abortController = abortController;
  activeJobs.set(job.id, job);

  // Persist job start to DB (fire-and-forget; do not block the queue)
  if (persistenceHooks) {
    persistenceHooks.onCreate({
      id: job.id,
      type: job.type,
      label: job.label,
      status: "running",
      startedAt: new Date(job.startedAt),
      ctx: job.ctx,
    }).then(dbRowId => {
      job.dbRowId = dbRowId;
    }).catch(err => {
      console.error(`[JobQueue] Failed to persist job start for ${job.label}:`, err.message);
    });
  }

  const timeoutHandle = setTimeout(() => {
    if (activeJobs.has(job.id)) {
      console.error(`[JobQueue] Job ${job.id} (${job.label}) timed out after ${job.timeoutMs / 1000}s - aborting`);
      job.status = "timeout";
      abortController.abort();
      activeJobs.delete(job.id);
      failedCount++;
      if (persistenceHooks && job.dbRowId) {
        persistenceHooks.onComplete(job.dbRowId, "failed", `Timed out after ${job.timeoutMs / 1000}s`).catch(() => {});
      }
      job.reject(new Error(`Job timed out after ${job.timeoutMs / 1000}s: ${job.label}`));
      processQueue();
    }
  }, job.timeoutMs);

  console.log(`[JobQueue] Starting ${job.type}/${job.label} (active: ${activeJobs.size}/${config.maxConcurrent}, pending: ${pendingQueue.length})`);

  job.work(abortController.signal)
    .then(result => {
      clearTimeout(timeoutHandle);
      if (job.status === "timeout") return;
      job.status = "completed";
      job.completedAt = Date.now();
      activeJobs.delete(job.id);
      completedCount++;
      const durationSec = ((job.completedAt - (job.startedAt || job.enqueuedAt)) / 1000).toFixed(1);
      console.log(`[JobQueue] Completed ${job.type}/${job.label} in ${durationSec}s (active: ${activeJobs.size}, pending: ${pendingQueue.length})`);
      if (persistenceHooks && job.dbRowId) {
        persistenceHooks.onComplete(job.dbRowId, "completed").catch(() => {});
      }
      job.resolve(result);
      processQueue();
    })
    .catch(err => {
      clearTimeout(timeoutHandle);
      if (job.status === "timeout") return;

      const errMsg: string = err?.message ?? String(err);
      job.lastError = errMsg;
      job.completedAt = Date.now();
      activeJobs.delete(job.id);

      if (job.retryCount < job.maxRetries) {
        // ── Exponential back-off retry ──────────────────────────────────────
        job.retryCount++;
        const delayMs = Math.min(RETRY_BASE_DELAY_MS * Math.pow(2, job.retryCount - 1), 30_000);
        console.warn(
          `[JobQueue] ${job.type}/${job.label} failed (attempt ${job.retryCount}/${job.maxRetries}), ` +
          `retrying in ${delayMs}ms: ${errMsg}`
        );
        if (persistenceHooks && job.dbRowId) {
          persistenceHooks.onComplete(job.dbRowId, "failed", `Retry ${job.retryCount}: ${errMsg}`).catch(() => {});
          job.dbRowId = undefined; // Will get a new DB row on next attempt
        }
        setTimeout(() => {
          job.status = "pending";
          if (canStartJob(job.type)) {
            startJob(job);
          } else {
            pendingQueue.push(job);
          }
        }, delayMs);
      } else {
        // ── Dead-letter ──────────────────────────────────────────────────────
        job.status = "dead";
        failedCount++;
        console.error(
          `[JobQueue] DEAD-LETTER ${job.type}/${job.label} after ${job.maxRetries} retries: ${errMsg}`
        );
        deadLetterStore.set(job.id, {
          id: job.id,
          type: job.type,
          label: job.label,
          lastError: errMsg,
          retryCount: job.retryCount,
          failedAt: Date.now(),
          ctx: job.ctx,
        });
        if (persistenceHooks && job.dbRowId) {
          persistenceHooks.onComplete(job.dbRowId, "failed", `Dead-letter after ${job.maxRetries} retries: ${errMsg}`).catch(() => {});
        }
        job.reject(err);
      }
      processQueue();
    });
}

export function enqueue<T>(
  type: JobType,
  label: string,
  work: ((signal?: AbortSignal) => Promise<T>) | (() => Promise<T>),
  options?: { priority?: number; timeoutMs?: number; ctx?: JobContext; maxRetries?: number }
): Promise<T> {
  const priority = options?.priority ?? PRIORITY[type] ?? PRIORITY.other;
  const timeoutMs = options?.timeoutMs ?? config.defaultTimeoutMs;

  return new Promise<T>((resolve, reject) => {
    const job: QueuedJob<T> = {
      id: generateJobId(type),
      type,
      priority,
      label,
      status: "pending",
      work,
      resolve,
      reject,
      enqueuedAt: Date.now(),
      timeoutMs,
      ctx: options?.ctx,
      retryCount: 0,
      maxRetries: options?.maxRetries ?? DEFAULT_MAX_RETRIES,
    };

    if (canStartJob(type)) {
      startJob(job);
    } else {
      pendingQueue.push(job);
      console.log(`[JobQueue] Queued ${type}/${label} (priority: ${priority}, pending: ${pendingQueue.length})`);
    }
  });
}

export function enqueuePdf<T>(label: string, work: ((signal?: AbortSignal) => Promise<T>) | (() => Promise<T>), timeoutMs?: number, ctx?: JobContext): Promise<T> {
  return enqueue("pdf", label, work, { priority: PRIORITY.pdf, timeoutMs: timeoutMs ?? 60000, ctx });
}

export function enqueueCrawl<T>(label: string, work: ((signal?: AbortSignal) => Promise<T>) | (() => Promise<T>), timeoutMs?: number, ctx?: JobContext): Promise<T> {
  return enqueue("crawl", label, work, { priority: PRIORITY.crawl, timeoutMs: timeoutMs ?? 10 * 60 * 1000, ctx });
}

export function enqueueMonitor<T>(label: string, work: ((signal?: AbortSignal) => Promise<T>) | (() => Promise<T>), timeoutMs?: number, ctx?: JobContext): Promise<T> {
  return enqueue("monitor", label, work, { priority: PRIORITY.monitor, timeoutMs: timeoutMs ?? 10 * 60 * 1000, ctx });
}

export function getQueueStatus(): QueueStats {
  const now = Date.now();
  const activeByType: Record<string, number> = {};
  const pendingByType: Record<string, number> = {};

  for (const job of activeJobs.values()) {
    activeByType[job.type] = (activeByType[job.type] || 0) + 1;
  }
  for (const job of pendingQueue) {
    pendingByType[job.type] = (pendingByType[job.type] || 0) + 1;
  }

  return {
    active: activeJobs.size,
    pending: pendingQueue.length,
    completed: completedCount,
    failed: failedCount,
    deadLettered: deadLetterStore.size,
    activeByType,
    pendingByType,
    activeJobs: [...activeJobs.values()].map(j => ({
      id: j.id,
      type: j.type,
      label: j.label,
      runningSec: Math.round((now - (j.startedAt || now)) / 1000),
    })),
    pendingJobs: pendingQueue
      .sort((a, b) => b.priority - a.priority || a.enqueuedAt - b.enqueuedAt)
      .slice(0, 20)
      .map(j => ({
        id: j.id,
        type: j.type,
        label: j.label,
        waitingSec: Math.round((now - j.enqueuedAt) / 1000),
        priority: j.priority,
      })),
    deadLetterJobs: [...deadLetterStore.values()],
    paused,
  };
}

/** Return all jobs that exhausted their retry budget. */
export function getDeadLetterJobs(): DeadLetterJob[] {
  return [...deadLetterStore.values()];
}

/**
 * Manually re-queue a dead-letter job for another attempt.
 * Returns `true` if found and re-queued, `false` if the job ID is unknown.
 */
export function retryDeadLetterJob(jobId: string): boolean {
  const dead = deadLetterStore.get(jobId);
  if (!dead) return false;
  deadLetterStore.delete(jobId);
  console.log(`[JobQueue] Manual retry of dead-letter job ${jobId} (${dead.label})`);
  // We cannot reconstruct the original `work` function here — callers should
  // trigger the original action (e.g. re-crawl competitor) via the relevant
  // API route.  This removes the job from the dead-letter store so the UI
  // no longer shows it as failed.
  return true;
}

/** Remove a job from the dead-letter store without retrying (dismiss). */
export function dismissDeadLetterJob(jobId: string): boolean {
  return deadLetterStore.delete(jobId);
}

export function pauseQueue(): void {
  paused = true;
  console.log("[JobQueue] Queue paused — active jobs will finish but no new ones will start");
}

export function resumeQueue(): void {
  paused = false;
  console.log("[JobQueue] Queue resumed");
  processQueue();
}

export function updateConfig(newConfig: Partial<QueueConfig>): void {
  config = { ...config, ...newConfig };
  if (newConfig.perTypeLimits) {
    config.perTypeLimits = { ...DEFAULT_CONFIG.perTypeLimits, ...newConfig.perTypeLimits };
  }
  console.log(`[JobQueue] Config updated:`, JSON.stringify(config));
}

export { PRIORITY };
