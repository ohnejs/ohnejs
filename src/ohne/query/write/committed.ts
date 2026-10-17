import type { CollectionName } from '../../collections/known-collections.ts';
import type { Transaction } from '../../database/adapter.ts';

import { isUndefined } from '../../../utils/index.ts';
import { applyHook } from '../../hooks/apply-hook.ts';
import { useHooks } from '../../hooks/use-hooks.ts';

/**
 * The kind of write a `record:committed` effect fired for.
 */
export type WriteOperation = 'create' | 'update' | 'delete';

/**
 * The payload a `record:committed` effect receives once a self-owned write has committed.
 */
export interface RecordCommitted {
  /**
   * The collection that was written, by name.
   */
  collection: CollectionName;

  /**
   * Whether the committed write created, updated, or deleted the records.
   */
  operation: WriteOperation;

  /**
   * The `UUID`s of the records the write affected.
   */
  uuids: readonly string[];
}

declare module 'ohnejs' {
  interface Hooks {
    /**
     * Runs after a write commits, for external effects that must never fire on a rollback.
     * Fires post-commit, outside the transaction, so a cache bust, a webhook, or an external index is safe.
     * A joined `.use(tx)` write inside another write's hook fires once that write commits.
     * A joined write unwound by its savepoint never fires, nor does one on a transaction you opened yourself.
     * A `deleteTranslation` reports an `update` of the records that lost the locale.
     * A create with `locales` reports one `create`, every locale included.
     * An action: its return is ignored.
     * The payload carries the `collection`, the `operation`, and the affected `uuids`.
     */
    'record:committed': (event: RecordCommitted) => void | Promise<void>;
  }
}

const held = new WeakMap<Transaction, RecordCommitted[]>();

/**
 * Fires the `record:committed` effects for a write that just committed, skipping when nothing subscribes.
 * A write joined to `joinedTx` holds its effect until the write that opened `joinedTx` commits.
 * A write that affected no rows fires nothing, so a no-op update or delete stays silent.
 */
export async function commitEffects(event: RecordCommitted, joinedTx?: Transaction): Promise<void> {
  if (event.uuids.length === 0) return;
  if (!isUndefined(joinedTx)) {
    held.get(joinedTx)?.push(event);
    return;
  }
  const callbacks = useHooks().get('record:committed');
  if (isUndefined(callbacks) || callbacks.length === 0) return;
  await applyHook('record:committed', event);
}

/**
 * Runs a self-owned write's `attempt` on `tx`, collecting into `into` the effects its joined writes hold.
 */
export function holdEffects<T>(tx: Transaction, into: RecordCommitted[], attempt: () => T): T {
  held.set(tx, into);
  return attempt();
}

/**
 * How many effects `tx` holds, the mark a savepoint unwinds back to.
 */
export function heldCount(tx: Transaction): number {
  return held.get(tx)?.length ?? 0;
}

/**
 * Drops the effects `tx` gained since `mark`, since the savepoint that wrote them unwound.
 */
export function dropHeld(tx: Transaction, mark: number): void {
  held.get(tx)?.splice(mark);
}
