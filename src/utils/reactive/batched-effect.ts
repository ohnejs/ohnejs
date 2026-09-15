import { type Effect, register, runEffect, stopEffect } from './_runtime.ts';
import { dequeue, enqueue } from './_scheduler.ts';

/**
 * Runs `fn` immediately, then re-runs it on a microtask whenever a tracked dependency changes.
 *
 * Unlike `effect`, re-runs are batched: many synchronous writes coalesce into one re-run.
 * Created inside an `effectScope`, the effect is stopped when that scope is disposed.
 * The returned function stops the effect and cancels any pending re-run.
 *
 * @example
 * ```ts
 * const count = ref(0)
 *
 * batchedEffect(() => console.log(count.value)) // logs 0
 * count.value = 1
 * count.value = 2
 * // one microtask later: logs 2 once, the two writes coalesced
 * ```
 */
export function batchedEffect(fn: () => void): () => void {
  const e: Effect = {
    fn,
    deps: new Set(),
    active: true,
  };
  const job = () => runEffect(e);
  e.scheduler = () => enqueue(job);
  register(e);
  const stop = () => {
    stopEffect(e);
    dequeue(job);
  };
  try {
    runEffect(e);
  } catch (error) {
    stop();
    throw error;
  }
  return stop;
}
