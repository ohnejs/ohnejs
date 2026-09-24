import { useDatabase } from 'ohnejs';
import { isUndefined, uniqueArray } from 'ohnejs/utils';

import type { UploadReach } from './_reach.ts';
import type { UploadRecord } from './types.ts';

import { drainJournal } from '../storage/journal.ts';
import { moveRow } from './_patch.ts';
import { assertReached, assertUploadsReach, reachedSubtree } from './_reach.ts';
import { decorated, outermostRows, readUploads } from './_row.ts';
import { canonicalDirectory, uploadPath } from './path.ts';

/**
 * Options for `moveUploads`.
 */
export interface MoveUploadsOptions {
  /**
   * The read scope every row this write names, moves, or creates must stay inside; omitted moves unscoped.
   */
  reach?: UploadReach;
}

/**
 * Moves many rows into one directory, all in one transaction or none at all.
 *
 * Each row moves as `moveUpload` moves it; a row already in `directory` stays where it is.
 * A row inside a folder that moves goes along with that folder.
 * Any refusal rolls every row back and throws the error that row alone would raise.
 * So a folder moved into itself, or a target already taken, is a `422` for the whole call.
 * An unknown `UUID`, or one `reach` hides, is a `404`.
 * With `reach`, a write that would hide a named row, a moved one, or a created folder is a `422`.
 * The journal drains once after the commit.
 * Resolves every named row as it now is, duplicates dropped, in the order given.
 *
 * @example
 * ```ts
 * const records = await moveUploads([sunset.UUID, photos.UUID], 'archive')
 * records.map((record) => record.path) // -> ['archive/sunset.jpg', 'archive/photos']
 * ```
 */
export async function moveUploads(
  uuids: readonly string[],
  directory: string,
  options: MoveUploadsOptions = {},
): Promise<UploadRecord[]> {
  const { reach } = options;
  const unique = uniqueArray(uuids);
  const target = canonicalDirectory(directory);
  const records = await useDatabase().transaction(async (tx) => {
    if (!isUndefined(reach)) await assertUploadsReach(unique, reach, tx);
    const rows = await readUploads(unique, tx);
    const touched = [...unique];
    for (const row of outermostRows(rows.filter((row) => row.directory !== target))) {
      const below = row.kind === 'folder' ? await reachedSubtree(tx, reach, uploadPath(row)) : [];
      const { created } = await moveRow(tx, row.UUID, { directory: target }, true);
      touched.push(...below, ...created);
    }
    await assertReached(tx, reach, touched);
    return readUploads(unique, tx);
  }, 'immediate');
  await drainJournal();
  return records.map(decorated);
}
