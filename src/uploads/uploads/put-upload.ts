import type { Transaction } from 'ohnejs';

import { queryUntyped, useDatabase } from 'ohnejs';
import { extname, mediaTypeMatches, mimeTypeFor, parseMediaType } from 'ohnejs/utils';

import type { QueryRecord } from '../../ohne/query/read/find.ts';
import type { UploadReach } from './_reach.ts';
import type { StagedUpload } from './_stage.ts';
import type { UploadRecord } from './types.ts';

import { validationError } from '../../ohne/query/write/errors.ts';
import { useUploadsConfig } from '../config.ts';
import { drainJournal, journalStorage } from '../storage/journal.ts';
import { isNotUnique, uploadsError } from './_errors.ts';
import { ensureFolders } from './_folders.ts';
import { assertReached } from './_reach.ts';
import { decorated } from './_row.ts';
import { claimStaged, discardStaged, stageUpload } from './_stage.ts';
import { canonicalDirectory, canonicalName, uniqueUploadName, uploadPath } from './path.ts';

/**
 * What `putUpload` takes: where the file goes and the bytes it holds.
 */
export interface PutUploadInput {
  /**
   * The parent path, canonicalized before use; `''` is the root.
   */
  directory: string;

  /**
   * The file name, canonicalized before use.
   * Its extension names the media type, and a name already taken gets a `-2` suffix.
   */
  name: string;

  /**
   * The file's bytes.
   */
  body: ReadableStream<Uint8Array>;

  /**
   * The declared byte length, when the request carried one.
   */
  size?: number;

  /**
   * The `UUID` of the uploading user, `null` when there is none.
   */
  author?: string | null;

  /**
   * The read scope every row this write touches or creates must stay inside; omitted writes unscoped.
   */
  reach?: UploadReach;
}

const OCTET_STREAM = 'application/octet-stream';

const NAME_ATTEMPTS = 5;

/**
 * Stores a new file: its bytes in storage and its row in `Uploads`, at one canonical path.
 *
 * The bytes stream to a temp object first, verified against the extension's type and measured.
 * One transaction then creates the missing folder rows, picks a free name, and creates the row.
 * The same transaction journals the move into place.
 * A file inside a private folder is born private; the journal locks its staged object before the move.
 * The journal drains after the commit, so the object lands at its path once the row exists.
 * A type outside `uploads.types` is a `422`; so is content that contradicts the extension.
 * A failure after staging removes the temp object.
 *
 * @example
 * ```ts
 * const upload = await putUpload({ directory: 'photos', name: 'Sunset.JPG', body })
 * upload.path // -> 'photos/sunset.jpg'
 * ```
 */
export async function putUpload(input: PutUploadInput): Promise<UploadRecord> {
  const directory = canonicalDirectory(input.directory);
  const name = canonicalName(input.name);
  const author = input.author ?? null;
  const type = parseMediaType(mimeTypeFor(extname(name)) ?? OCTET_STREAM).type;
  if (!mediaTypeMatches(type, useUploadsConfig().types)) {
    throw uploadsError('name', 'typeNotAllowed', { type });
  }

  const staged = await stageUpload(input.body, { type, size: input.size });
  let record: QueryRecord;
  try {
    record = await useDatabase().transaction(async (tx) => {
      await claimStaged(tx, staged.temp);
      const { locked, created } = await ensureFolders(tx, directory, author);
      const row = await createFile(tx, { directory, name, type, author, private: locked }, staged);
      await assertReached(tx, input.reach, [row.UUID as string, ...created]);
      const path = uploadPath(row);
      if (locked) await journalStorage(tx, { op: 'lock', from: staged.temp });
      await journalStorage(tx, { op: 'move', from: staged.temp, to: path });
      return row;
    }, 'immediate');
  } catch (error) {
    await discardStaged(staged.temp);
    throw error;
  }
  await drainJournal();
  return decorated(record);
}

/**
 * Creates the file row under a name free among its siblings, retrying the next suffix on a lost race.
 */
async function createFile(
  tx: Transaction,
  file: { directory: string; name: string; type: string; author: string | null; private: boolean },
  { size, hash, width, height }: StagedUpload,
): Promise<QueryRecord & { directory: string; name: string }> {
  const siblings = (await queryUntyped('Uploads')
    .use(tx)
    .where({ directory: file.directory })
    .pluck('name')) as string[];
  let name = uniqueUploadName(file.name, siblings);
  for (let attempt = 1; ; attempt++) {
    const outcome = await queryUntyped('Uploads')
      .use(tx)
      .create({ ...file, kind: 'file', name, size, hash, width, height });
    if (outcome.ok) return outcome.record as QueryRecord & { directory: string; name: string };
    if (attempt === NAME_ATTEMPTS || !isNotUnique(outcome.errors)) {
      throw validationError(outcome.errors);
    }
    siblings.push(name);
    name = uniqueUploadName(file.name, siblings);
  }
}
