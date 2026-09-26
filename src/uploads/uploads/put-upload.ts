import type { UploadReach } from './_reach.ts';
import type { UploadRecord } from './types.ts';

import { drainJournal } from '../storage/journal.ts';
import { landUpload } from './_land.ts';
import { assertPathFits } from './_path-limit.ts';
import { claimStaged, discardStaged, stageUpload } from './_stage.ts';
import { assertTypeAllowed, uploadType } from './_type.ts';
import { canonicalDirectory, canonicalName, uploadPath } from './path.ts';

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

/**
 * Stores a new file: its bytes in storage and its row in `Uploads`, at one canonical path.
 *
 * The bytes stream to a temp object first, verified against the extension's type and measured.
 * One transaction then creates the missing folder rows, picks a free name, and creates the row.
 * The same transaction journals the move into place.
 * A file inside a private folder is born private; the journal locks its staged object before the move.
 * The journal drains after the commit, so the object lands at its path once the row exists.
 * A type outside `uploads.types` is a `422`; so is content that contradicts the extension.
 * So is a path past 768 bytes, the suffix of a taken name included, as a `422` at `directory`.
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
  const type = uploadType(name);
  assertTypeAllowed(type);
  assertPathFits(uploadPath({ directory, name }));

  const staged = await stageUpload(input.body, { type, size: input.size });
  let record: UploadRecord;
  try {
    record = await landUpload(
      staged,
      { directory, name, type, author, reach: input.reach },
      { claim: (tx) => claimStaged(tx, staged.temp) },
    );
  } catch (error) {
    await discardStaged(staged.temp);
    throw error;
  }
  await drainJournal();
  return record;
}
