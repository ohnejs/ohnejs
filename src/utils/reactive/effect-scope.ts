import { last } from '../array/last.ts';
import { isNull } from '../is/is-null.ts';
import { activeScope, runWithScope, type Scope, stopEffect } from './_runtime.ts';

/**
 * A disposable owner for the effects and nested scopes created while it is active.
 */
export interface EffectScope {
  /**
   * Runs `fn` with this scope active, so effects and nested scopes created inside are owned by it.
   */
  run<T>(fn: () => T): T;

  /**
   * Stops every owned effect, runs every registered cleanup, and disposes nested scopes.
   * Idempotent - a second call is a no-op.
   */
  dispose(): void;
}

/**
 * Creates an ownership group for fine-grained effects.
 *
 * Effects and computeds created inside `run` are stopped when the scope is disposed.
 * A scope created inside another scope's `run` is itself owned by that outer scope.
 * `detached` opts out of that adoption: the scope takes no parent and outlives the creating scope.
 * Only its own `dispose` tears it down.
 *
 * @example
 * ```ts
 * const scope = effectScope()
 * const count = ref(0)
 *
 * scope.run(() => effect(() => console.log(count.value))) // logs 0
 *
 * count.value = 1 // logs 1
 * scope.dispose()
 * count.value = 2 // nothing logged
 *
 * const outer = effectScope()
 * const inner = outer.run(() => effectScope(true))
 * outer.dispose() // `inner` stays active until `inner.dispose()`
 * ```
 */
export function effectScope(detached = false): EffectScope {
  const parent = detached ? null : activeScope();
  const scope: Scope = {
    effects: [],
    scopes: [],
    cleanups: [],
    parent,
    index: isNull(parent) ? -1 : parent.scopes.length,
    active: true,
  };
  if (!isNull(parent)) parent.scopes.push(scope);

  return {
    run: (fn) => runWithScope(scope, fn),
    dispose: () => disposeScope(scope),
  };
}

/**
 * Registers `fn` to run when the active scope is disposed.
 * A no-op at the top level, where no scope is active.
 *
 * @example
 * ```ts
 * const scope = effectScope()
 *
 * scope.run(() => onCleanup(() => console.log('bye')))
 * scope.dispose() // logs 'bye'
 * ```
 */
export function onCleanup(fn: () => void): void {
  const scope = activeScope();
  if (!isNull(scope)) scope.cleanups.push(fn);
}

/**
 * Disposes `scope` once: stops its effects, runs its cleanups, disposes its children, then detaches it.
 */
function disposeScope(scope: Scope): void {
  if (!scope.active) return;
  scope.active = false;
  for (const e of scope.effects) stopEffect(e);
  for (const fn of scope.cleanups) fn();
  for (const child of scope.scopes) disposeScope(child);
  scope.cleanups.length = 0;
  scope.effects.length = 0;
  scope.scopes.length = 0;
  detach(scope);
}

/**
 * Swaps the last sibling into the slot of `scope` to detach it in O(1), unless the parent is disposing.
 */
function detach(scope: Scope): void {
  const parent = scope.parent;
  if (isNull(parent) || !parent.active) return;
  const moved = last(parent.scopes) as Scope;
  parent.scopes[scope.index] = moved;
  moved.index = scope.index;
  parent.scopes.pop();
}
