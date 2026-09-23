import { isNumber, isString, isUndefined } from 'ohnejs/utils';

import {
  hasImageSecret,
  hasImageService,
  imageVariantURLs,
  isOptimizableImage,
} from '../images/image-url.ts';
import { privateExpiry } from './_expiry.ts';
import { privateUploads } from './_private.ts';
import { uploadPath } from './path.ts';
import { uploadURL } from './url.ts';

/**
 * Adds `path` and `url` to an `Uploads` record in place.
 * Adds `variants` too, one signed URL per configured variant, when the image service can render them.
 * Without an `UPLOADS_SECRET` the layer has no private files, so every record is decorated as public.
 * A private file otherwise gets the signed API route as `url`, and `expires`.
 * Its `variants` need an `IMAGES_SECRET` as well, since an unsigned service could not guard the original.
 * A file whose `select` left out `private` is decorated as private, since it may be one.
 * A folder gets `path` alone: it has no bytes to serve.
 * A record whose `select` dropped `directory` or `name` is left untouched.
 *
 * @example
 * ```ts
 * const record = { directory: 'photos', name: 'sunset.jpg', private: false }
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
  const locked = privateUploads() && (record.private === true || isUndefined(record.private));
  const expires = locked ? privateExpiry() : undefined;
  if (!isUndefined(expires)) record.expires = expires;
  record.url = uploadURL({ directory, name, private: locked, expires });
  const { type, focalX, focalY } = record;
  if (!isString(type) || !isOptimizableImage(type) || !hasImageService()) return;
  if (locked && (isUndefined(expires) || !hasImageSecret())) return;
  record.variants = imageVariantURLs({
    directory,
    name,
    type,
    focalX: numberOrNull(focalX),
    focalY: numberOrNull(focalY),
    private: locked,
    expires,
  });
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
