import { queryUntyped, useDatabase } from 'ohnejs';
import { isUndefined } from 'ohnejs/utils';

import type { QueryRecord } from '../../ohne/query/read/find.ts';
import type { UploadRow } from './_row.ts';
import type { UploadRecord } from './types.ts';

import { notFound } from '../../ohne/http/http-error.ts';
import { drainJournal, journalStorage } from '../storage/journal.ts';
import { uploadsError } from './_errors.ts';
import { decorated, readUpload } from './_row.ts';
import { claimStaged, discardStaged, stageUpload } from './_stage.ts';
import { uploadPath } from './path.ts';

/**
 * Options for `replaceUpload`.
 */
export interface ReplaceUploadOptions {
  /**
   * The declared byte length, when the request carried one.
   */
  size?: number;
}

/**
 * Replaces a file's bytes, keeping its path, type, and metadata.
 *
 * The bytes stream to a temp object first, verified against the row's type and measured.
 * One transaction then updates `size`, `hash`, `width`, and `height` and journals the move into place.
 * A private file's staged object is locked by the same journal before it moves into place.
 * The journal drains after the commit.
 * A folder is a `422`; content that contradicts the type is too; an unknown `UUID` a `404`.
 * A failure after staging removes the temp object.
 *
 * @example
 * ```ts
 * const upload = await replaceUpload(uuid, body)
 * upload.hash // -> the sha256 of the new bytes
 * ```
 */
export async function replaceUpload(
  uuid: string,
  body: ReadableStream<Uint8Array>,
  options: ReplaceUploadOptions = {},
): Promise<UploadRecord> {
  const row = await readUpload(uuid);
  if (row.kind !== 'file') throw uploadsError('name', 'notAFile');

  const { temp, ...measured } = await stageUpload(body, {
    type: row.type as string,
    size: options.size,
  });
  let record: QueryRecord;
  try {
    record = await useDatabase().transaction(async (tx) => {
      await claimStaged(tx, temp);
      const [updated] = await queryUntyped('Uploads')
        .use(tx)
        .where({ UUID: uuid })
        .updateOrThrow(measured);
      if (isUndefined(updated)) throw notFound();
      const landed = updated as UploadRow;
      const path = uploadPath(landed);
      if (landed.private) await journalStorage(tx, { op: 'lock', from: temp });
      await journalStorage(tx, { op: 'move', from: temp, to: path });
      return updated;
    }, 'immediate');
  } catch (error) {
    await discardStaged(temp);
    throw error;
  }
  await drainJournal();
  return decorated(record);
}
