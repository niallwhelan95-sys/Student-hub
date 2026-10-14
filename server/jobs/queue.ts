import { sql } from "drizzle-orm";
import { waitUntil } from "@vercel/functions";
import { getDb, rows } from "../db/client";
import { jobs } from "../db/schema";
import { env, isVercel } from "../env";

/**
 * Durable, database-backed job queue. Jobs survive restarts (anything left "running" after a
 * crash is re-queued at boot), are retried with exponential backoff, and record their last
 * error so failures are visible rather than silently lost.
 */
export type JobRow = {
  id: string;
  user_id: string | null;
  type: string;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
};

export type JobHandler = {
  run(payload: Record<string, unknown>, job: JobRow): Promise<void>;
  /** Called once when the final attempt fails, e.g. to mark a document as failed. */
  onFinalFailure?(payload: Record<string, unknown>, error: string, job: JobRow): Promise<void>;
};

const handlers = new Map<string, JobHandler>();

export function registerJob(type: string, handler: JobHandler): void {
  handlers.set(type, handler);
}

export async function enqueue(
  type: string,
  payload: Record<string, unknown>,
  opts: { userId?: string | null; delayMs?: number; maxAttempts?: number } = {},
): Promise<string> {
  const [row] = await getDb()
    .insert(jobs)
    .values({
      type,
      payload,
      userId: opts.userId ?? null,
      maxAttempts: opts.maxAttempts ?? 3,
      runAfter: new Date(Date.now() + (opts.delayMs ?? 0)),
    })
    .returning({ id: jobs.id });
  wake();
  return row.id;
}

/** A job still "running" after this long was abandoned (crash, or a serverless instance being frozen). */
const STALE_RUNNING = sql`interval '10 minutes'`;

async function claim(): Promise<JobRow | null> {
  const [job] = await rows<JobRow>(sql`
    UPDATE jobs SET status = 'running', attempts = attempts + 1, updated_at = now()
    WHERE id = (
      SELECT id FROM jobs
      WHERE (status = 'queued' AND run_after <= now())
         OR (status = 'running' AND updated_at < now() - ${STALE_RUNNING} AND attempts < max_attempts)
      ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED
    )
    RETURNING id, user_id, type, payload, attempts, max_attempts`);
  return job ?? null;
}

async function execute(job: JobRow): Promise<void> {
  const handler = handlers.get(job.type);
  try {
    if (!handler) throw new Error(`No handler registered for job type "${job.type}"`);
    await handler.run(job.payload, job);
    await rows(sql`UPDATE jobs SET status = 'done', last_error = NULL, updated_at = now() WHERE id = ${job.id}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const final = job.attempts >= job.max_attempts;
    console.warn(`[jobs] ${job.type} ${job.id} attempt ${job.attempts}/${job.max_attempts} failed: ${message}`);
    if (final) {
      await rows(sql`UPDATE jobs SET status = 'failed', last_error = ${message}, updated_at = now() WHERE id = ${job.id}`);
      try {
        await handler?.onFinalFailure?.(job.payload, message, job);
      } catch (e) {
        console.error(`[jobs] onFinalFailure for ${job.type} threw`, e);
      }
    } else {
      const backoffSec = 5 * 2 ** (job.attempts - 1);
      await rows(sql`
        UPDATE jobs SET status = 'queued', last_error = ${message},
          run_after = now() + make_interval(secs => ${backoffSec}), updated_at = now()
        WHERE id = ${job.id}`);
    }
  }
}

/** Process jobs until none are immediately runnable. Used by tests and the worker loop. */
export async function drainJobs(maxJobs = 1000): Promise<number> {
  let processed = 0;
  while (processed < maxJobs) {
    const job = await claim();
    if (!job) break;
    await execute(job);
    processed++;
  }
  return processed;
}

let timer: NodeJS.Timeout | null = null;
let running = false;
let stopped = true;

/**
 * Serverless mode (Vercel): there is no always-on worker, so queued work runs after the
 * current response via `waitUntil`, which keeps the function alive until it finishes.
 */
let serverlessDrain: Promise<unknown> | null = null;
let lastKick = 0;

function drainAfterResponse() {
  if (serverlessDrain) return;
  serverlessDrain = drainJobs(20)
    .catch((err) => console.error("[jobs] serverless drain failed", err))
    .finally(() => (serverlessDrain = null));
  waitUntil(serverlessDrain);
}

/** Called on ordinary API traffic in serverless mode so retries and leftovers get picked up. */
export function kickJobs(minIntervalMs = 15_000) {
  if (!isVercel) return;
  const now = Date.now();
  if (now - lastKick < minIntervalMs) return;
  lastKick = now;
  drainAfterResponse();
}

function wake() {
  if (isVercel) return drainAfterResponse();
  if (stopped || running) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(tick, 10);
}

async function tick() {
  if (stopped) return;
  running = true;
  try {
    await drainJobs(25);
  } catch (err) {
    console.error("[jobs] worker loop error", err);
  } finally {
    running = false;
    if (!stopped) timer = setTimeout(tick, env.JOB_POLL_MS);
  }
}

export async function startWorker(): Promise<void> {
  await rows(sql`UPDATE jobs SET status = 'queued', updated_at = now() WHERE status = 'running'`);
  stopped = false;
  timer = setTimeout(tick, 50);
}

export function stopWorker(): void {
  stopped = true;
  if (timer) clearTimeout(timer);
  timer = null;
}
