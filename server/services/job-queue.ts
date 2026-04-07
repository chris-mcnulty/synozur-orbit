type JobType = "pdf" | "crawl" | "monitor" | "analysis" | "other";
type JobStatus = "pending" | "active" | "completed" | "failed" | "timeout";

/** Optional context passed alongside a job for DB persistence and display. */
export interface JobContext {
  tenantDomain?: string;
  targetId?: string;
  targetName?: string;
}

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
  /** P3: Retry tracking */
  attempt: number;
  maxRetries: number;
}

// ---------------------------------------------------------------------------
// P3 — Dead-Letter Queue
// Jobs that exhaust retries land here for admin inspection / dismissal.
// ---------------------------------------------------------------------------
export interface DeadLetterEntry {
  jobId: string;
  type: JobType;
  label: string;
  error: string;
  attempts: number;
  failedAt: number;
  ctx?: JobContext;
}

const deadLetterStore: DeadLetterEntry[] = [];
const MAX_DLQ_SIZE = 200;

export function getDeadLetterJobs(): DeadLetterEntry[] {
  return [...deadLetterStore];
}

export function dismissDeadLetterJob(jobId: string): boolean {
  const idx = deadLetterStore.findIndex(e => e.jobId === jobId);
  if (idx === -1) return false;
  deadLetterStore.splice(idx, 1);
  return true;
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

interface QueueStats {
  active: number;
  pending: number;
  completed: number;
  failed: number;
  activeByType: Record<string, number>;
  pendingByType: Record<string, number>;
  activeJobs: Array<{ id: string; type: JobType; label: string; runningSec: number }>;
  pendingJobs: Array<{ id: string; type: JobType; label: string; waitingSec: number; priority: number }>;
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
      activeJobs.delete(job.id);

      // P3: Retry with exponential back-off (2s -> 4s -> 8s)
      if (job.attempt < job.maxRetries) {
        const nextAttempt = job.attempt + 1;
        const delay = 2000 * Math.pow(2, job.attempt); // 2s, 4s, 8s
        console.warn(`[JobQueue] Retrying ${job.type}/${job.label} (attempt ${nextAttempt}/${job.maxRetries}) in ${delay}ms — ${err.message}`);
        job.attempt = nextAttempt;
        job.status = "pending";
        setTimeout(() => {
          if (canStartJob(job.type)) {
            startJob(job);
          } else {
            pendingQueue.push(job);
          }
        }, delay);
        return;
      }

      // Exhausted retries — move to dead-letter queue
      job.status = "failed";
      job.completedAt = Date.now();
      failedCount++;
      console.error(`[JobQueue] Failed ${job.type}/${job.label} after ${job.attempt + 1} attempts: ${err.message}`);

      if (deadLetterStore.length >= MAX_DLQ_SIZE) {
        deadLetterStore.shift(); // evict oldest
      }
      deadLetterStore.push({
        jobId: job.id,
        type: job.type,
        label: job.label,
        error: err.message || String(err),
        attempts: job.attempt + 1,
        failedAt: Date.now(),
        ctx: job.ctx,
      });
      console.warn(`[JobQueue] Job ${job.id} moved to dead-letter queue (${deadLetterStore.length} entries)`);

      if (persistenceHooks && job.dbRowId) {
        persistenceHooks.onComplete(job.dbRowId, "failed", err.message).catch(() => {});
      }
      job.reject(err);
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
  const maxRetries = options?.maxRetries ?? 3;

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
      attempt: 0,
      maxRetries,
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
    paused,
  };
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
