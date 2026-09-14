import type { Transaction } from 'ohnejs';

import { queryUntyped, usePrinter } from 'ohnejs';
import { createMutex, errorMessage } from 'ohnejs/utils';

import type { QueryRecord } from '../../ohne/query/read/find.ts';
import type { StorageAdapter } from './adapter.ts';

import { useStorage } from './use-storages.ts';

/**
 * One storage effect waiting to run: a move of an object or prefix, or a delete of one.
 */
export type JournalEntry =
  | { op: 'move'; from: string; to: string }
  | { op: 'delete'; from: string };

const draining = createMutex();

/**
 * Records a storage effect on `tx`, so it commits or rolls back with the row change it belongs to.
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
  await queryUntyped('UploadsJournal')
    .use(tx)
    .createOrThrow({ op: entry.op, from: entry.from, to: entry.op === 'move' ? entry.to : null });
}

/**
 * Runs every pending storage effect in the order it was journaled, deleting each entry once it succeeded.
 * An effect that fails is warned about and left for the next drain.
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
    let entries: QueryRecord[];
    try {
      storage = useStorage();
      entries = await queryUntyped('UploadsJournal').orderBy('UUID').findMany();
    } catch (error) {
      usePrinter().warn(`Storage journal not drained: ${errorMessage(error)}`);
      return;
    }
    for (const entry of entries) {
      const { UUID, op, from, to } = entry as {
        UUID: string;
        op: 'move' | 'delete';
        from: string;
        to: string | null;
      };
      try {
        if (op === 'move') await storage.move(from, to as string);
        else await storage.delete(from);
        await queryUntyped('UploadsJournal').where({ UUID }).delete();
      } catch (error) {
        usePrinter().warn(`Storage \`${op}\` of \`${from}\` failed: ${errorMessage(error)}`);
      }
    }
  });
}
