import { hasKey } from '../object/has-key.ts';
import { extname } from '../path/extname.ts';
import { MIME_TYPES } from './_mime-types.ts';

/**
 * Returns the content-type for a file name or extension, from a curated table.
 * Accepts a path, a dotted extension, or a bare extension; the lookup is case-insensitive.
 *
 * Text types carry `; charset=utf-8`; binary types do not.
 * Returns `undefined` for an unknown or missing extension, so the caller chooses the fallback.
 *
 * @example
 * ```ts
 * mimeTypeFor('styles.css')  // -> 'text/css; charset=utf-8'
 * mimeTypeFor('photo.png')   // -> 'image/png'
 * mimeTypeFor('.json')       // -> 'application/json; charset=utf-8'
 * mimeTypeFor('archive.xyz') // -> undefined
 * ```
 */
export function mimeTypeFor(path: string): string | undefined {
  const raw = extname(path) || path;
  const ext = (raw.startsWith('.') ? raw.slice(1) : raw).toLowerCase();
  return hasKey(MIME_TYPES, ext) ? MIME_TYPES[ext] : undefined;
}
