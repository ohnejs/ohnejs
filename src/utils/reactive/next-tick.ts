import { nextTick as flushed } from './_scheduler.ts';

/**
 * Resolves once the pending batch of reactive re-runs has flushed.
 * Batched effects re-run on a microtask, so a write is visible in their output only after this.
 * Safe to await with nothing pending: it resolves on the next microtask flush.
 *
 * @example
 * ```ts
 * const count = ref(0)
 * const label = h('span', null, () => count.value)
 * count.value = 1
 * await nextTick() // label now renders '1'
 * ```
 */
export function nextTick(): Promise<void> {
  return flushed();
}
