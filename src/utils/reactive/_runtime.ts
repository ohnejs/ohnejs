import { last } from '../array/last.ts';
import { isNull } from '../is/is-null.ts';

/**
 * A unit of reactive work.
 * `fn` is the user callback; `scheduler` (when set) replaces `fn` on trigger - used by `computed`.
 * `deps` is the set of subscriber sets this effect has been added to, used for stale-dep cleanup.
 * `subs`, on a computed's runner, is that computed's own subscriber set.
 * `trigger` reads it to propagate invalidation before running any reader.
 * `scope`, when set, owns this effect: it stops the effect on disposal and is restored around re-runs.
 */
export interface Effect {
  fn: () => void;
  scheduler?: () => void;
  subs?: Set<Effect>;
  deps: Set<Set<Effect>>;
  active: boolean;
  scope?: Scope | null;
}

/**
 * An ownership group for the effects and nested scopes created while it is active.
 * `effects` and `scopes` are the children captured during a `runWithScope` run.
 * `cleanups` are teardown callbacks registered through `onCleanup`.
 * `parent` and `index` locate this scope in its parent's `scopes`, for O(1) detach on disposal.
 * `active` is false once disposed, which makes a second disposal a no-op.
 */
export interface Scope {
  effects: Effect[];
  scopes: Scope[];
  cleanups: (() => void)[];
  parent: Scope | null;
  index: number;
  active: boolean;
}

const effectStack: Effect[] = [];
const scopeStack: Scope[] = [];
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
 * Returns the scope at the top of the stack, or `null` if none is active.
 */
export function activeScope(): Scope | null {
  return last(scopeStack) ?? null;
}

/**
 * Runs `fn` with `s` pushed as the active scope, then pops it.
 * Effects and scopes created during `fn` are owned by `s`.
 */
export function runWithScope<T>(s: Scope, fn: () => T): T {
  scopeStack.push(s);
  try {
    return fn();
  } finally {
    scopeStack.pop();
  }
}

/**
 * Captures the active scope onto `e` and, when one is active, enlists `e` for disposal.
 * At the top level `e.scope` stays null, so `runEffect` runs `e` unwrapped - the same as before.
 */
export function register(e: Effect): void {
  const scope = activeScope();
  e.scope = scope;
  if (!isNull(scope)) scope.effects.push(e);
}

/**
 * Stops `e`: marks it inactive and detaches it from every dependency.
 * Idempotent - a second call is a no-op.
 */
export function stopEffect(e: Effect): void {
  if (!e.active) return;
  e.active = false;
  cleanup(e);
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
 * An owned effect is run with its scope restored, so children it creates are captured by that scope.
 * No-op when `e.active` is false.
 */
export function runEffect(e: Effect): void {
  if (!e.active) return;
  cleanup(e);
  if (e.scope) runWithScope(e.scope, () => runWithEffect(e, e.fn));
  else runWithEffect(e, e.fn);
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
 * Invalidates every computed reachable from `subs` and collects the plain effects to run.
 * Walking the whole graph first ensures no effect reads a computed before it is invalidated.
 */
function invalidate(
  subs: Set<Effect>,
  current: Effect | null,
  effects: Set<Effect>,
  seen: Set<Effect>,
): void {
  for (const e of Array.from(subs)) {
    if (e === current || seen.has(e)) continue;
    seen.add(e);
    if (e.scheduler) {
      e.scheduler();
      if (e.subs) invalidate(e.subs, current, effects, seen);
    } else {
      effects.add(e);
    }
  }
}

/**
 * Notifies every subscriber of `subs`.
 * Skips the currently active effect to avoid self-triggers.
 * Runs synchronously - no batching.
 *
 * Every reachable computed is invalidated before any effect runs.
 * An effect that reads a diamond dependency therefore never observes a stale derived value.
 */
export function trigger(subs: Set<Effect>): void {
  const current = activeEffect();
  const effects = new Set<Effect>();
  invalidate(subs, current, effects, new Set());

  let firstError: unknown;
  let captured = false;
  for (const e of effects) {
    try {
      runEffect(e);
    } catch (err) {
      if (!captured) {
        firstError = err;
        captured = true;
      }
    }
  }
  if (captured) throw firstError;
}
