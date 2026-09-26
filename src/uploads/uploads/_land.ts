import type { Transaction } from 'ohnejs';

import { queryUntyped, useDatabase } from 'ohnejs';

import type { UploadReach } from './_reach.ts';
import type { UploadRow } from './_row.ts';
import type { StagedUpload } from './_stage.ts';
import type { UploadRecord } from './types.ts';

import { validationError } from '../../ohne/query/write/errors.ts';
import { journalStorage } from '../storage/journal.ts';
import { isNotUnique } from './_errors.ts';
import { ensureFolders } from './_folders.ts';
import { assertPathFits } from './_path-limit.ts';
import { assertReached } from './_reach.ts';
import { decorated } from './_row.ts';
import { uniqueUploadName, uploadPath } from './path.ts';

/**
 * Where `landUpload` puts a staged file, and who owns it.
 */
export interface LandUploadTarget {
  /**
   * The canonical parent path; `''` is the root.
   */
  directory: string;

  /**
   * The canonical file name; a name already taken gets a `-2` suffix.
   */
  name: string;

  /**
   * The media type the row records, already checked against `uploads.types`.
   */
  type: string;

  /**
   * The `UUID` of the uploading user, `null` when there is none.
   */
  author: string | null;

  /**
   * The read scope every row the landing creates must stay inside; omitted lands unscoped.
   */
  reach?: UploadReach;
}

/**
 * What the caller of `landUpload` runs inside its transaction.
 */
export interface LandUploadHooks {
  /**
   * Takes the staged object for the new `row` on `tx`, before its move is journaled.
   * A throw rolls the whole landing back.
   */
  claim(tx: Transaction, row: UploadRow): Promise<void>;
}

const NAME_ATTEMPTS = 5;

/**
 * Lands a staged file in `Uploads`, resolving its record.
 *
 * One `'immediate'` transaction creates the missing folder rows, picks a free name, and creates the row.
 * It checks `target.reach` against the row and every folder it created, then runs `hooks.claim`.
 * The same transaction journals the move of `staged.temp` to the row's path.
 * A file inside a private folder is born private; the journal locks its staged object before the move.
 * It never drains the journal, so the caller runs `drainJournal` after it, outside any lock it holds.
 * A file in the way of a folder is a `422` at `directory`.
 * So is a suffix that would carry the path past 768 bytes.
 *
 * @example
 * ```ts
 * const record = await landUpload(
 *   staged,
 *   { directory: 'photos', name: 'sunset.jpg', type: 'image/jpeg', author: null },
 *   { claim: (tx) => claimStaged(tx, staged.temp) },
 * )
 * await drainJournal()
 * record.path // -> 'photos/sunset.jpg'
 * ```
 */
export async function landUpload(
  staged: StagedUpload,
  target: LandUploadTarget,
  hooks: LandUploadHooks,
): Promise<UploadRecord> {
  const { directory, name, type, author, reach } = target;
  const record = await useDatabase().transaction(async (tx) => {
    const { locked, created } = await ensureFolders(tx, directory, author);
    const row = await createFile(tx, { directory, name, type, author, private: locked }, staged);
    await assertReached(tx, reach, [row.UUID, ...created]);
    await hooks.claim(tx, row);
    if (locked) await journalStorage(tx, { op: 'lock', from: staged.temp });
    await journalStorage(tx, { op: 'move', from: staged.temp, to: uploadPath(row) });
    return row;
  }, 'immediate');
  return decorated(record);
}

/**
 * Creates the file row under a name free among its siblings, retrying the next suffix on a lost race.
 * A suffix that would carry the path past 768 bytes is a `422` at `directory`.
 */
async function createFile(
  tx: Transaction,
  file: { directory: string; name: string; type: string; author: string | null; private: boolean },
  { size, hash, width, height }: StagedUpload,
): Promise<UploadRow> {
  const siblings = (await queryUntyped('Uploads')
    .use(tx)
    .where({ directory: file.directory })
    .pluck('name')) as string[];
  let name = uniqueUploadName(file.name, siblings);
  for (let attempt = 1; ; attempt++) {
    assertPathFits(uploadPath({ directory: file.directory, name }));
    const outcome = await queryUntyped('Uploads')
      .use(tx)
      .create({ ...file, kind: 'file', name, size, hash, width, height });
    if (outcome.ok) return outcome.record as UploadRow;
    if (attempt === NAME_ATTEMPTS || !isNotUnique(outcome.errors)) {
      throw validationError(outcome.errors);
    }
    siblings.push(name);
    name = uniqueUploadName(file.name, siblings);
  }
}
