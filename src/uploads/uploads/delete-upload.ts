import { queryUntyped, useDatabase } from 'ohnejs';
import { isUndefined } from 'ohnejs/utils';

import type { UploadReach } from './_reach.ts';

import { drainJournal, journalStorage } from '../storage/journal.ts';
import { assertUploadReach } from './_reach.ts';
import { readUpload } from './_row.ts';
import { uploadPath } from './path.ts';

/**
 * Options for `deleteUpload`.
 */
export interface DeleteUploadOptions {
  /**
   * The read scope the row must be inside; omitted deletes unscoped.
   * A folder it admits still goes with its whole subtree, rows the scope hides included.
   */
  reach?: UploadReach;
}

/**
 * Deletes a row and its object; a folder takes its whole subtree with it.
 *
 * One transaction removes the rows and journals the delete of the path, a folder being its prefix.
 * The journal drains after the commit, so the objects go once no row names them.
 * An unknown `UUID`, or one `reach` hides, is a `404`.
 *
 * @example
 * ```ts
 * await deleteUpload(uuid)
 * ```
 */
export async function deleteUpload(uuid: string, options: DeleteUploadOptions = {}): Promise<void> {
  await useDatabase().transaction(async (tx) => {
    if (!isUndefined(options.reach)) await assertUploadReach(uuid, options.reach, tx);
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
