import { last } from '../array/last.ts';
import { isNull } from '../is/is-null.ts';

/**
 * A unit of reactive work.
 * `fn` is the user callback; `scheduler` (when set) replaces `fn` on trigger - used by `computed`.
 * `deps` is the set of subscriber sets this effect has been added to, used for stale-dep cleanup.
 */
export interface Effect {
  fn: () => void;
  scheduler?: () => void;
  deps: Set<Set<Effect>>;
  active: boolean;
}

const effectStack: Effect[] = [];
let shouldTrack = true;

/**
 * Returns the effect at the top of the stack, or `null` if none is active.
 */
export function activeEffect(): Effect | null {
  return last(effectStack) ?? null;
}

/**
 * Runs `fn` with `e` pushed as the active effect, then pops it.
 * Tracking is forced on for the duration.
 * An effect or computed nested inside an `untracked` block still subscribes to its deps.
 */
export function runWithEffect<T>(e: Effect, fn: () => T): T {
  effectStack.push(e);
  const prevTrack = shouldTrack;
  shouldTrack = true;
  try {
    return fn();
  } finally {
    shouldTrack = prevTrack;
    effectStack.pop();
  }
}

/**
 * Runs `fn` with reactive tracking suspended, then restores the prior state.
 * The active effect stays on the stack so `trigger` still skips it on a self-write.
 */
export function runUntracked<T>(fn: () => T): T {
  const prev = shouldTrack;
  shouldTrack = false;
  try {
    return fn();
  } finally {
    shouldTrack = prev;
  }
}

/**
 * Detaches `e` from every subscriber set it had joined.
 * Called before re-running or stopping an effect.
 */
export function cleanup(e: Effect): void {
  for (const dep of e.deps) dep.delete(e);
  e.deps.clear();
}

/**
 * Re-runs `e` from scratch: cleans up old deps, then executes `fn` inside the active context.
 * No-op when `e.active` is false.
 */
export function runEffect(e: Effect): void {
  if (!e.active) return;
  cleanup(e);
  runWithEffect(e, e.fn);
}

/**
 * Registers the active effect as a subscriber of `subs`.
 * No-op when tracking is suspended, when no effect is active, or when already subscribed.
 */
export function track(subs: Set<Effect>): void {
  if (!shouldTrack) return;
  const e = activeEffect();
  if (isNull(e) || subs.has(e)) return;
  subs.add(e);
  e.deps.add(subs);
}

/**
 * Notifies every subscriber of `subs`.
 * Skips the currently active effect to avoid self-triggers.
 * Runs synchronously - no batching.
 */
export function trigger(subs: Set<Effect>): void {
  const current = activeEffect();
  const snapshot = Array.from(subs);
  for (const e of snapshot) {
    if (e === current) continue;
    if (e.scheduler) e.scheduler();
    else runEffect(e);
  }
}
