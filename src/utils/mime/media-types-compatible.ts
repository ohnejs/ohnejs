import { parseMediaType } from '../media-type/parse-media-type.ts';

const EQUIVALENT_TYPES: readonly (readonly string[])[] = [
  ['image/png', 'image/apng'],
  ['image/jpeg', 'image/pjpeg'],
  ['image/heic', 'image/heif', 'image/avif'],
  ['video/mp4', 'video/x-m4v', 'video/quicktime', 'audio/mp4'],
  ['video/webm', 'audio/webm'],
  ['audio/mpeg', 'audio/mp3'],
  ['application/ogg', 'audio/ogg', 'video/ogg', 'audio/opus'],
  [
    'application/zip',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.oasis.opendocument.text',
    'application/vnd.oasis.opendocument.spreadsheet',
    'application/vnd.oasis.opendocument.presentation',
    'application/java-archive',
    'application/epub+zip',
  ],
  ['application/x-tar', 'application/tar'],
  ['font/ttf', 'application/x-font-ttf', 'font/sfnt'],
  ['font/otf', 'application/x-font-otf'],
];

/**
 * Reports whether a declared media type agrees with the one sniffed from the bytes.
 * Parameters and case are ignored, so `text/HTML; charset=utf-8` agrees with `text/html`.
 *
 * Aliases and types sharing one container also agree, from a curated table of equivalence groups.
 * `video/quicktime` agrees with `video/mp4`, `application/zip` with every zip-based office format.
 * The relation is symmetric.
 *
 * @example
 * ```ts
 * mediaTypesCompatible('text/html; charset=utf-8', 'text/HTML') // -> true
 * mediaTypesCompatible('image/heic', 'image/avif')              // -> true
 * mediaTypesCompatible('video/quicktime', 'video/mp4')          // -> true
 * mediaTypesCompatible('image/png', 'text/html')                // -> false
 * ```
 */
export function mediaTypesCompatible(declared: string, sniffed: string): boolean {
  const a = parseMediaType(declared).type;
  const b = parseMediaType(sniffed).type;
  return a === b || EQUIVALENT_TYPES.some((group) => group.includes(a) && group.includes(b));
}
