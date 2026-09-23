import { useDatabase } from 'ohnejs';

import type { UploadRecord } from './types.ts';

import { drainJournal } from '../storage/journal.ts';
import { updateRow } from './_patch.ts';
import { decorated } from './_row.ts';

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
 * Making a row public inside a private folder is a `422`.
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
  const record = await useDatabase().transaction(
    (tx) => updateRow(tx, uuid, input, options.locale),
    'immediate',
  );
  await drainJournal();
  return decorated(record);
}
