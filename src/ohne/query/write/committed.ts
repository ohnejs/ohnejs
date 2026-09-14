import type { CollectionName } from '../../collections/known-collections.ts';

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
     * Runs after a self-owned write commits, for external effects that must never fire on a rollback.
     * Fires post-commit, outside the transaction, so a cache bust, a webhook, or an external index is safe.
     * A joined `.use(tx)` write skips it: the effect defers to whoever owns the outer commit.
     * An action: its return is ignored.
     * The payload carries the `collection`, the `operation`, and the affected `uuids`.
     */
    'record:committed': (event: RecordCommitted) => void | Promise<void>;
  }
}

/**
 * Fires the `record:committed` effects for a write that just committed, skipping when nothing subscribes.
 * A write that affected no rows fires nothing, so a no-op update or delete stays silent.
 */
export async function commitEffects(event: RecordCommitted): Promise<void> {
  if (event.uuids.length === 0) return;
  const callbacks = useHooks().get('record:committed');
  if (isUndefined(callbacks) || callbacks.length === 0) return;
  await applyHook('record:committed', event);
}
