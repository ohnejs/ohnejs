import { useDatabase } from 'ohnejs';
import { isUndefined, uniqueArray } from 'ohnejs/utils';

import type { UploadReach } from './_reach.ts';
import type { UploadRecord } from './types.ts';

import { drainJournal } from '../storage/journal.ts';
import { updateRow } from './_patch.ts';
import { assertReached, assertUploadsReach, reachedSubtree } from './_reach.ts';
import { decorated, readUploads } from './_row.ts';
import { uploadPath } from './path.ts';

/**
 * Options for `setUploadsPrivate`.
 */
export interface SetUploadsPrivateOptions {
  /**
   * The read scope every row this write names or reaches must stay inside; omitted writes unscoped.
   */
  reach?: UploadReach;
}

/**
 * Makes many rows private or public, all in one transaction or none at all.
 *
 * Each row changes as `updateUpload` changes its `private`; a folder takes everything inside it along.
 * Folders go before what they hold, so a folder made public frees the rows named inside it.
 * Making a row public inside a private folder is a `422` for the whole call, and nothing changes.
 * An unknown `UUID`, or one `reach` hides, is a `404`.
 * With `reach`, a write that would hide a named row or one inside a named folder is a `422`.
 * The journal drains once after the commit.
 * Resolves every named row as it now is, duplicates dropped, in the order given.
 *
 * @example
 * ```ts
 * const records = await setUploadsPrivate([photos.UUID, notes.UUID], true)
 * records.map((record) => record.private) // -> [true, true]
 * ```
 */
export async function setUploadsPrivate(
  uuids: readonly string[],
  value: boolean,
  options: SetUploadsPrivateOptions = {},
): Promise<UploadRecord[]> {
  const { reach } = options;
  const unique = uniqueArray(uuids);
  const records = await useDatabase().transaction(async (tx) => {
    if (!isUndefined(reach)) await assertUploadsReach(unique, reach, tx);
    const rows = await readUploads(unique, tx);
    const touched = [...unique];
    const shallowFirst = rows.toSorted((a, b) => uploadPath(a).length - uploadPath(b).length);
    for (const row of shallowFirst) {
      const below = row.kind === 'folder' ? await reachedSubtree(tx, reach, uploadPath(row)) : [];
      await updateRow(tx, row.UUID, { private: value });
      touched.push(...below);
    }
    await assertReached(tx, reach, touched);
    return readUploads(unique, tx, reach);
  }, 'immediate');
  await drainJournal();
  return records.map(decorated);
}
