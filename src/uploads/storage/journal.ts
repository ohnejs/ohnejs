import type { Transaction } from 'ohnejs';

import { queryUntyped, usePrinter } from 'ohnejs';
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
type StoredEntry = { UUID: string; op: JournalEntry['op']; from: string; to: string | null };

const draining = createMutex();

/**
 * Records a storage effect on `tx`, so it commits or rolls back with the row change it belongs to.
 * The entry takes the `sequence` after the last pending one; an `'immediate'` `tx` keeps it unique.
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
    .orderBy('sequence', 'desc')
    .limit(1)
    .pluck('sequence')) as (number | null)[];
  await queryUntyped('UploadsJournal')
    .use(tx)
    .createOrThrow({
      sequence: (last ?? 0) + 1,
      op: entry.op,
      from: entry.from,
      to: entry.op === 'move' ? entry.to : null,
    });
}

/**
 * Runs every pending storage effect in the order it was journaled, deleting each entry once it succeeded.
 * An effect that fails is warned about and left for the next drain.
 * So is every later entry on its path, or above or below it, since that entry may build on it.
 * So is a journal that cannot be read or a storage that cannot be built; nothing here throws.
 * Drains serialize, so two callers never replay the same entry at once.
 *
 * @example
 * ```ts
 * await drainJournal()
 * ```
 */
export function drainJournal(): Promise<void> {
  return draining(async () => {
    let storage: StorageAdapter;
    let entries: StoredEntry[];
    try {
      storage = useStorage();
      entries = (await queryUntyped('UploadsJournal')
        .orderBy('sequence')
        .findMany()) as StoredEntry[];
    } catch (error) {
      usePrinter().warn(`Storage journal not drained: ${errorMessage(error)}`);
      return;
    }
    const held: string[] = [];
    for (const entry of entries) {
      const paths = isNull(entry.to) ? [entry.from] : [entry.from, entry.to];
      const waits = paths.some((path) => held.some((other) => overlaps(path, other)));
      if (waits || !(await settle(storage, entry))) held.push(...paths);
    }
  });
}

/**
 * Runs one entry's effect and deletes the entry, resolving `true`, or warns and resolves `false`.
 * A backend without `setPrivate` has no visibility to set, so a lock or unlock succeeds at once.
 */
async function settle(
  storage: StorageAdapter,
  { UUID, op, from, to }: StoredEntry,
): Promise<boolean> {
  try {
    if (op === 'move') await storage.move(from, to as string);
    else if (op === 'delete') await storage.delete(from);
    else await storage.setPrivate?.(from, op === 'lock');
    await queryUntyped('UploadsJournal').where({ UUID }).delete();
    return true;
  } catch (error) {
    usePrinter().warn(`Storage \`${op}\` of \`${from}\` failed: ${errorMessage(error)}`);
    return false;
  }
}

/**
 * Whether two storage paths name the same object, or one lies under the other as a prefix.
 */
function overlaps(a: string, b: string): boolean {
  return isPathInside(a, b) || isPathInside(b, a);
}
