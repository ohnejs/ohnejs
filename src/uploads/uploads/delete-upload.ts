import { queryUntyped, useDatabase } from 'ohne';

import { drainJournal, journalStorage } from '../storage/journal.ts';
import { readUpload } from './_row.ts';
import { uploadPath } from './path.ts';

/**
 * Deletes a row and its object; a folder takes its whole subtree with it.
 *
 * One transaction removes the rows and journals the delete of the path, a folder being its prefix.
 * The journal drains after the commit, so the objects go once no row names them.
 * An unknown `UUID` is a `404`.
 *
 * @example
 * ```ts
 * await deleteUpload(uuid)
 * ```
 */
export async function deleteUpload(uuid: string): Promise<void> {
  await useDatabase().transaction(async (tx) => {
    const row = await readUpload(uuid, tx);
    const path = uploadPath(row);
    if (row.kind === 'folder') {
      await queryUntyped('Uploads')
        .use(tx)
        .whereAny((g) => [
          g.where({ directory: path }),
          g.where({ directory: { startsWith: `${path}/` } }),
        ])
        .delete();
    }
    await queryUntyped('Uploads').use(tx).where({ UUID: uuid }).delete();
    await journalStorage(tx, { op: 'delete', from: path });
  }, 'immediate');
  await drainJournal();
}
