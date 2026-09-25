import { parseMediaType } from '../media-type/parse-media-type.ts';
import { MIME_TYPES } from './_mime-types.ts';

const EXTENSIONS = Map.groupBy(
  Object.keys(MIME_TYPES),
  (extension) => parseMediaType(MIME_TYPES[extension]).type,
);

/**
 * Returns the file extension for a content-type, the inverse of the curated table behind `mimeTypeFor`.
 * Parameters are ignored and the lookup is case-insensitive.
 * A type several extensions share maps to the first one the table lists, as `.jpg` for `image/jpeg`.
 *
 * The extension carries its leading dot, as `extname` returns it, so a caller appends it as is.
 * Returns `undefined` for a type the table does not know, so the caller chooses the fallback.
 *
 * @example
 * ```ts
 * extensionFor('image/jpeg')                   // -> '.jpg'
 * extensionFor('IMAGE/SVG+XML; charset=utf-8') // -> '.svg'
 * extensionFor('text/html; charset=utf-8')     // -> '.html'
 * extensionFor('application/x-unknown')        // -> undefined
 * ```
 */
export function extensionFor(type: string): string | undefined {
  const extension = EXTENSIONS.get(parseMediaType(type).type)?.[0];
  return extension && `.${extension}`;
}
