import { queryUntyped, useDatabase } from 'ohnejs';
import { isBoolean, isUndefined, omit } from 'ohnejs/utils';

import type { UploadRecord } from './types.ts';

import { drainJournal, journalStorage } from '../storage/journal.ts';
import { privateUploads } from './_private.ts';
import { decorated, readUpload } from './_row.ts';
import { setDescendantsPrivate } from './_subtree.ts';
import { uploadPath } from './path.ts';

/**
 * The metadata `updateUpload` changes; an omitted field keeps its value.
 */
export interface UpdateUploadInput {
  /**
   * The alt text at the write's locale, `null` to clear it.
   */
  description?: string | null;

  /**
   * The focal point's horizontal position, `0` to `1`, `null` to clear it.
   */
  focalX?: number | null;

  /**
   * The focal point's vertical position, `0` to `1`, `null` to clear it.
   */
  focalY?: number | null;

  /**
   * Whether the bytes open only through an expiring link or for a signed-in reader with access.
   * A folder applies it to everything inside it.
   */
  private?: boolean;
}

/**
 * Options for `updateUpload`.
 */
export interface UpdateUploadOptions {
  /**
   * The content locale `description` lands on; omitted writes the default locale.
   */
  locale?: string;
}

/**
 * Updates a row's metadata: the alt text, the focal point, and whether it is private.
 * A folder's `private` applies to everything inside it, and storage locks or unlocks the objects to match.
 * Without an `UPLOADS_SECRET` the layer has no private files, so `private` is ignored.
 * An out-of-range value is the pipeline's `422`; an unknown `UUID` a `404`.
 *
 * @example
 * ```ts
 * await updateUpload(uuid, { description: 'Sunset over the bay' }, { locale: 'de' })
 * await updateUpload(uuid, { focalX: 0.3, focalY: 0.7 })
 * await updateUpload(uuid, { private: true })
 * ```
 */
export async function updateUpload(
  uuid: string,
  input: UpdateUploadInput,
  options: UpdateUploadOptions = {},
): Promise<UploadRecord> {
  const locks = isBoolean(input.private) && privateUploads();
  const record = await useDatabase().transaction(async (tx) => {
    const row = await readUpload(uuid, tx);
    const builder = queryUntyped('Uploads').use(tx).where({ UUID: uuid });
    const changes = locks || !isBoolean(input.private) ? input : omit(input, ['private']);
    const [updated] = await (
      isUndefined(options.locale) ? builder : builder.locale(options.locale)
    ).updateOrThrow({ ...changes });
    if (!locks || input.private === (row.private === true)) return updated;
    const path = uploadPath(row);
    if (row.kind === 'folder') await setDescendantsPrivate(tx, path, input.private === true);
    await journalStorage(tx, { op: input.private ? 'lock' : 'unlock', from: path });
    return updated;
  }, 'immediate');
  await drainJournal();
  return decorated(record);
}
