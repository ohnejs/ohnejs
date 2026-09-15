import { isNumber, isString } from 'ohnejs/utils';

import { hasImageService, imageVariantURLs, isOptimizableImage } from '../images/image-url.ts';
import { uploadPath } from './path.ts';
import { uploadURL } from './url.ts';

/**
 * Adds `path` and `url` to an `Uploads` record in place.
 * Adds `variants` too, one signed URL per configured variant, when the image service can render them.
 * A folder gets `path` alone: it has no bytes to serve.
 * A record whose `select` dropped `directory` or `name` is left untouched.
 *
 * @example
 * ```ts
 * const record = { directory: 'photos', name: 'sunset.jpg' }
 * decorateUpload(record)
 * record.path // -> 'photos/sunset.jpg'
 * record.url  // -> '/uploads/photos/sunset.jpg'
 * ```
 */
export function decorateUpload(record: Record<string, unknown>): void {
  const { directory, name } = record;
  if (!isString(directory) || !isString(name)) return;
  record.path = uploadPath({ directory, name });
  if (record.kind === 'folder') return;
  record.url = uploadURL({ directory, name });
  const { type, focalX, focalY } = record;
  if (isString(type) && isOptimizableImage(type) && hasImageService()) {
    record.variants = imageVariantURLs({
      directory,
      name,
      type,
      focalX: numberOrNull(focalX),
      focalY: numberOrNull(focalY),
    });
  }
}

/**
 * Decorates every record of a read, as `decorateUpload` does one.
 *
 * @example
 * ```ts
 * const records = [{ directory: 'photos', name: 'sunset.jpg' }, { directory: '', name: 'notes.pdf' }]
 * decorateUploads(records)
 * ```
 */
export function decorateUploads(records: Record<string, unknown>[]): void {
  for (const record of records) decorateUpload(record);
}

/**
 * A stored focal axis as the image source expects it, `null` when the record holds none.
 */
function numberOrNull(value: unknown): number | null {
  return isNumber(value) ? value : null;
}
