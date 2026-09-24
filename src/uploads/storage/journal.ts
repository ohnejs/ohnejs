import type { Transaction } from 'ohnejs';

import { queryUntyped, usePrinter, withLock } from 'ohnejs';
import { createMutex, errorMessage, isNull, isPathInside } from 'ohnejs/utils';

import type { StorageAdapter } from './adapter.ts';

import { useStorage } from './use-storages.ts';

/**
 * One storage effect waiting to run.
 * A move of an object or prefix, a delete of one, or a lock or unlock of one, setting it private or not.
 */
export type JournalEntry =
  | { op: 'move'; from: string; to: string }
  | { op: 'delete'; from: string }
  | { op: 'lock' | 'unlock'; from: string };

/**
 * A journal row as a drain reads it.
 */
type StoredEntry = {
  UUID: string;
  op: JournalEntry['op'] | 'stage';
  from: string;
  to: string | null;
};

const draining = createMutex();

const JOURNAL_LOCK = 'uploads:journal';

const SETTLE_STALE_AFTER = 10 * 60 * 1000;

/**
 * Records a storage effect on `tx`, so it commits or rolls back with the row change it belongs to.
 * The entry takes the `sequence` after the last pending one; an `'immediate'` `tx` keeps it unique.
 * The journal is bookkeeping, so every read and write of it skips the app's scoping hooks.
 * `drainJournal` runs it after the commit.
 *
 * @example
 * ```ts
 * await useDatabase().transaction(async (tx) => {
 *   await queryUntyped('Uploads').use(tx).where({ UUID }).delete()
 *   await journalStorage(tx, { op: 'delete', from: 'photos/sunset.jpg' })
 * }, 'immediate')
 * await drainJournal()
 * ```
 */
export async function journalStorage(tx: Transaction, entry: JournalEntry): Promise<void> {
  const [last] = (await queryUntyped('UploadsJournal')
    .use(tx)
    .unscoped()
    .orderBy('sequence', 'desc')
    .limit(1)
    .pluck('sequence')) as (number | null)[];
  await queryUntyped('UploadsJournal')
    .use(tx)
    .unscoped()
    .createOrThrow({
      sequence: (last ?? 0) + 1,
      op: entry.op,
      from: entry.from,
      to: entry.op === 'move' ? entry.to : null,
    });
}

/**
 * Runs every pending storage effect in the order it was journaled, deleting each entry once it succeeded.
 * A `stage` entry is no effect, so it stays for `claimStaged` or `sweepStaged`.
 * An effect that fails is warned about and left for the next drain.
 * So is every later entry on its path, or above or below it, since that entry may build on it.
 * So is a journal that cannot be read or a storage that cannot be built; nothing here throws.
 * Each entry settles under a cluster lock, so no two instances replay the same entry at once.
 * Otherwise a slow replay of an older entry could land after a newer one on the same path.
 * The lock goes stale after ten minutes, so an effect that runs longer may be replayed by another instance.
 * Resolves `true` when every entry settled, and `false` when any was held or nothing could be drained.
 *
 * @example
 * ```ts
 * await drainJournal() // -> true
 * ```
 */
export function drainJournal(): Promise<boolean> {
  return draining(async () => {
    try {
      return await drain();
    } catch (error) {
      usePrinter().warn(`Storage journal not drained: ${errorMessage(error)}`);
      return false;
    }
  });
}

/**
 * Settles every pending entry in `sequence` order, holding back the later ones on a failed entry's paths.
 */
async function drain(): Promise<boolean> {
  const storage = useStorage();
  const entries = (await queryUntyped('UploadsJournal')
    .unscoped()
    .orderBy('sequence')
    .findMany()) as StoredEntry[];
  const held: string[] = [];
  for (const entry of entries) {
    if (entry.op === 'stage') continue;
    const paths = isNull(entry.to) ? [entry.from] : [entry.from, entry.to];
    const waits = paths.some((path) => held.some((other) => overlaps(path, other)));
    if (waits || !(await settle(storage, entry))) held.push(...paths);
  }
  return held.length === 0;
}

/**
 * Runs one entry's effect under the cluster lock and deletes the entry, resolving `true`.
 * An entry another instance settled meanwhile is skipped as done.
 * A failed effect is warned about and resolves `false`.
 * A backend without `setPrivate` has no visibility to set, so a lock or unlock succeeds at once.
 */
function settle(storage: StorageAdapter, entry: StoredEntry): Promise<boolean> {
  return withLock(
    JOURNAL_LOCK,
    async () => {
      const { UUID, op, from, to } = entry;
      if (!(await pending(UUID))) return true;
      try {
        if (op === 'move') await storage.move(from, to as string);
        else if (op === 'delete') await storage.delete(from);
        else await storage.setPrivate?.(from, op === 'lock');
      } catch (error) {
        usePrinter().warn(`Storage \`${op}\` of \`${from}\` failed: ${errorMessage(error)}`);
        return false;
      }
      await queryUntyped('UploadsJournal').unscoped().where({ UUID }).delete();
      return true;
    },
    { staleAfter: SETTLE_STALE_AFTER },
  );
}

/**
 * Whether the entry `UUID` is still in the journal.
 */
function pending(UUID: string): Promise<boolean> {
  return queryUntyped('UploadsJournal').unscoped().where({ UUID }).exists();
}

/**
 * Whether two storage paths name the same object, or one lies under the other as a prefix.
 */
function overlaps(a: string, b: string): boolean {
  return isPathInside(a, b) || isPathInside(b, a);
}
