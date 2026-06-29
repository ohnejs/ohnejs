const queue = new Set<() => void>();
const resolvers: (() => void)[] = [];
let scheduled = false;
let flushing = false;

/**
 * Schedules a microtask flush, unless one is already pending.
 */
function schedule(): void {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(flush);
}

/**
 * Adds `job` to the queue and schedules a flush.
 * The queue is a set, so enqueuing the same `job` twice still runs it once per flush.
 */
export function enqueue(job: () => void): void {
  queue.add(job);
  schedule();
}

/**
 * Removes `job` from the queue, so a not-yet-run job never runs.
 */
export function dequeue(job: () => void): void {
  queue.delete(job);
}

/**
 * Drains the queue synchronously, running each job once.
 * A job enqueued during the flush runs in the same flush.
 * The first error is captured and rethrown once the rest have run, leaving the queue usable.
 */
export function flush(): void {
  if (flushing) return;
  flushing = true;
  let firstError: unknown;
  let captured = false;
  try {
    while (queue.size > 0) {
      for (const job of queue) {
        queue.delete(job);
        try {
          job();
        } catch (error) {
          if (!captured) {
            firstError = error;
            captured = true;
          }
        }
      }
    }
  } finally {
    flushing = false;
    scheduled = false;
    for (const resolve of resolvers.splice(0)) resolve();
  }
  if (captured) throw firstError;
}

/**
 * Returns a promise that resolves after the current queue has flushed.
 */
export function nextTick(): Promise<void> {
  return new Promise((resolve) => {
    resolvers.push(resolve);
    schedule();
  });
}
