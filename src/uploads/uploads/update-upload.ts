import { queryUntyped } from 'ohne';
import { isUndefined } from 'ohne/utils';

import type { UploadRecord } from './types.ts';

import { notFound } from '../../ohne/http/http-error.ts';
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
 * Updates a row's metadata: the alt text and the focal point.
 * Storage is untouched.
 * An out-of-range value is the pipeline's `422`; an unknown `UUID` a `404`.
 *
 * @example
 * ```ts
 * await updateUpload(uuid, { description: 'Sunset over the bay' }, { locale: 'de' })
 * await updateUpload(uuid, { focalX: 0.3, focalY: 0.7 })
 * ```
 */
export async function updateUpload(
  uuid: string,
  input: UpdateUploadInput,
  options: UpdateUploadOptions = {},
): Promise<UploadRecord> {
  const builder = queryUntyped('Uploads').where({ UUID: uuid });
  const records = await (
    isUndefined(options.locale) ? builder : builder.locale(options.locale)
  ).updateOrThrow({ ...input });
  const [record] = records;
  if (isUndefined(record)) throw notFound();
  return decorated(record);
}
