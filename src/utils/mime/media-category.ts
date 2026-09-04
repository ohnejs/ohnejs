import { parseMediaType } from '../media-type/parse-media-type.ts';
import { hasKey } from '../object/has-key.ts';

/**
 * The broad kind of file a media type describes, as `mediaCategory` classifies it.
 */
export type MediaCategory = (typeof MEDIA_CATEGORIES)[number];

/**
 * Every `MediaCategory`, in display order.
 */
export const MEDIA_CATEGORIES = [
  'image',
  'video',
  'audio',
  'document',
  'archive',
  'font',
  'text',
  'code',
  'other',
] as const;

const TOP_LEVEL_CATEGORIES: Record<string, MediaCategory> = {
  image: 'image',
  video: 'video',
  audio: 'audio',
  font: 'font',
  text: 'text',
};

const CATEGORIES: Record<string, MediaCategory> = {
  'text/html': 'code',
  'text/css': 'code',
  'text/javascript': 'code',
  'text/xml': 'code',
  'text/csv': 'code',

  'application/pdf': 'document',
  'application/msword': 'document',
  'application/rtf': 'document',
  'application/vnd.ms-excel': 'document',
  'application/vnd.ms-powerpoint': 'document',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'document',
  'application/vnd.oasis.opendocument.text': 'document',
  'application/vnd.oasis.opendocument.spreadsheet': 'document',
  'application/vnd.oasis.opendocument.presentation': 'document',

  'application/zip': 'archive',
  'application/gzip': 'archive',
  'application/x-7z-compressed': 'archive',
  'application/x-rar-compressed': 'archive',
  'application/vnd.rar': 'archive',
  'application/x-tar': 'archive',
  'application/x-bzip2': 'archive',
  'application/x-xz': 'archive',

  'application/json': 'code',
  'application/ld+json': 'code',
  'application/javascript': 'code',
  'application/xml': 'code',
  'application/yaml': 'code',
  'application/x-yaml': 'code',
  'application/wasm': 'code',
  'application/toml': 'code',
};

/**
 * Classifies a media type into a broad `MediaCategory` for grouping and filtering files.
 * Parameters and case are ignored, so `text/plain; charset=utf-8` is `'text'`.
 *
 * `image/*`, `video/*`, `audio/*`, and `font/*` map to their top-level type.
 * `text/*` is `'text'`, except the markup and data formats a developer edits, which are `'code'`.
 * `application/*` is resolved from a curated table of document, archive, and code formats.
 * Anything unlisted is `'other'`.
 *
 * @example
 * ```ts
 * mediaCategory('image/png')                 // -> 'image'
 * mediaCategory('text/plain; charset=utf-8') // -> 'text'
 * mediaCategory('text/html')                 // -> 'code'
 * mediaCategory('application/pdf')           // -> 'document'
 * mediaCategory('application/zip')           // -> 'archive'
 * mediaCategory('application/octet-stream')  // -> 'other'
 * ```
 */
export function mediaCategory(type: string): MediaCategory {
  const essence = parseMediaType(type).type;
  if (hasKey(CATEGORIES, essence)) return CATEGORIES[essence];
  const [topLevel] = essence.split('/');
  return hasKey(TOP_LEVEL_CATEGORIES, topLevel) ? TOP_LEVEL_CATEGORIES[topLevel] : 'other';
}
