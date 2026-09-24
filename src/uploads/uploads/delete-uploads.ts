import { useDatabase } from 'ohnejs';
import { isUndefined, uniqueArray } from 'ohnejs/utils';

import type { UploadReach } from './_reach.ts';

import { drainJournal } from '../storage/journal.ts';
import { deleteRow } from './_patch.ts';
import { assertUploadsReach } from './_reach.ts';
import { outermostRows, readUploads } from './_row.ts';

/**
 * Options for `deleteUploads`.
 */
export interface DeleteUploadsOptions {
  /**
   * The read scope every named row must be inside; omitted deletes unscoped.
   * A folder it admits still goes with its whole subtree, rows the scope hides included.
   */
  reach?: UploadReach;
}

/**
 * Deletes many rows and their objects, all in one transaction or none at all.
 *
 * Each row goes as `deleteUpload` deletes it; a folder takes its whole subtree along.
 * A row inside a named folder goes with that folder.
 * An unknown `UUID`, or one `reach` hides, is a `404`, and nothing is deleted.
 * The journal drains once after the commit.
 *
 * @example
 * ```ts
 * await deleteUploads([sunset.UUID, photos.UUID])
 * ```
 */
export async function deleteUploads(
  uuids: readonly string[],
  options: DeleteUploadsOptions = {},
): Promise<void> {
  const unique = uniqueArray(uuids);
  await useDatabase().transaction(async (tx) => {
    if (!isUndefined(options.reach)) await assertUploadsReach(unique, options.reach, tx);
    for (const row of outermostRows(await readUploads(unique, tx))) await deleteRow(tx, row);
  }, 'immediate');
  await drainJournal();
}
