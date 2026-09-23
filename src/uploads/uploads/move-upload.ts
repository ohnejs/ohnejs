import { useDatabase } from 'ohnejs';

import type { UploadRecord } from './types.ts';

import { drainJournal } from '../storage/journal.ts';
import { moveRow } from './_patch.ts';
import { decorated } from './_row.ts';

/**
 * Where `moveUpload` takes a row: each part canonicalized, each defaulting to the current value.
 */
export interface MoveUploadTarget {
  /**
   * The new parent path; omitted keeps the current one.
   */
  directory?: string;

  /**
   * The new name; omitted keeps the current one.
   * A file keeps its extension, since the extension names its immutable type.
   */
  name?: string;
}

/**
 * Renames a row, moves it to another directory, or both, moving its object along.
 *
 * One transaction creates the missing folder rows of the target, updates the row, and journals the move.
 * A folder's descendants have their `directory` rewritten by prefix in one statement.
 * A public row moved into a private folder becomes private, a folder with everything inside it.
 * The same journal locks its object before the move; moving out of a private folder never unlocks.
 * A rename that stays in its folder leaves `private` as it is.
 * The journal drains after the commit, so the object moves once the row points at its new path.
 * A file whose extension would change is a `422`; so is a folder moved into itself.
 * A target already taken is the pipeline's `422`; an unknown `UUID` a `404`.
 *
 * @example
 * ```ts
 * await moveUpload(uuid, { directory: 'photos/2024' })
 * await moveUpload(uuid, { name: 'Dusk.jpg' })
 * ```
 */
export async function moveUpload(uuid: string, to: MoveUploadTarget): Promise<UploadRecord> {
  const { record } = await useDatabase().transaction(
    (tx) => moveRow(tx, uuid, to, true),
    'immediate',
  );
  await drainJournal();
  return decorated(record);
}
