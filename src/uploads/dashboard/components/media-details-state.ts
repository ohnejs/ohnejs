import { basename, clamp, isNull } from 'ohnejs/utils';

import type { UploadRecord } from '../../uploads/types.ts';

import { isDisplayableImage } from './media-library-state.ts';

/**
 * The tabs of the details popup.
 */
export type DetailsTab = 'details' | 'description' | 'variants';

/**
 * What the details popup previews: a displayable image, a playable video, or nothing.
 */
export type DetailsPreview = 'image' | 'video';

/**
 * The editable part of a file's details, the shape the popup's history stores.
 */
export type DetailsState = {
  /**
   * The alt text in the content locale, `null` when none is set.
   */
  description: string | null;

  /**
   * The focal point's horizontal position, `0` to `1`, `null` when none is set.
   */
  focalX: number | null;

  /**
   * The focal point's vertical position, `0` to `1`, `null` when none is set.
   */
  focalY: number | null;
};

/**
 * The video types a browser plays in a `<video>`.
 */
export const PLAYABLE_VIDEO_TYPES: ReadonlySet<string> = new Set([
  'video/mp4',
  'video/webm',
  'video/ogg',
]);

// An image no larger than this centers in the preview instead of spanning it.
const SMALL_PREVIEW = 480;

/**
 * What the popup previews for a record, `null` when the type neither displays nor plays.
 *
 * @example
 * ```ts
 * previewKindOf(png)  // -> 'image'
 * previewKindOf(mp4)  // -> 'video'
 * previewKindOf(pdf)  // -> null
 * ```
 */
export function previewKindOf(record: UploadRecord): DetailsPreview | null {
  if (isDisplayableImage(record)) return 'image';
  if (record.kind === 'file' && !isNull(record.type) && PLAYABLE_VIDEO_TYPES.has(record.type)) {
    return 'video';
  }
  return null;
}

/**
 * Whether an image is small enough to center in the preview: at most 480 pixels on both sides.
 * An unsized image never is.
 *
 * @example
 * ```ts
 * isSmallPreview({ ...png, width: 320, height: 240 })  // -> true
 * isSmallPreview({ ...png, width: 1920, height: 240 }) // -> false
 * ```
 */
export function isSmallPreview(record: UploadRecord): boolean {
  return (
    !isNull(record.width) &&
    !isNull(record.height) &&
    record.width <= SMALL_PREVIEW &&
    record.height <= SMALL_PREVIEW
  );
}

/**
 * The editable details of a record, as the history stores them.
 *
 * @example
 * ```ts
 * detailsStateOf(sunset) // -> { description: 'Sunset', focalX: 0.5, focalY: 0.25 }
 * ```
 */
export function detailsStateOf(record: UploadRecord): DetailsState {
  return { description: record.description, focalX: record.focalX, focalY: record.focalY };
}

/**
 * The focal point a click at `x`, `y` inside a `width` by `height` surface sets.
 * Each fraction is clamped to `0`..`1` and rounded to three decimals.
 *
 * @example
 * ```ts
 * focalPointAt(25, 50, 100, 200) // -> { focalX: 0.25, focalY: 0.25 }
 * focalPointAt(-5, 300, 100, 200) // -> { focalX: 0, focalY: 1 }
 * ```
 */
export function focalPointAt(
  x: number,
  y: number,
  width: number,
  height: number,
): { focalX: number; focalY: number } {
  return { focalX: focalFraction(x, width), focalY: focalFraction(y, height) };
}

/**
 * A focal fraction as the CSS percentage that positions its marker, to one decimal.
 *
 * @example
 * ```ts
 * focalPercent(0.333) // -> '33.3%'
 * focalPercent(1)     // -> '100%'
 * ```
 */
export function focalPercent(fraction: number): string {
  return `${Math.round(fraction * 1000) / 10}%`;
}

/**
 * The `PATCH` body a saved state sends: the description, and the focal point when the file is an image.
 *
 * @example
 * ```ts
 * detailsPatch({ description: 'Sunset', focalX: 0.5, focalY: 0.5 }, false) // -> { description: 'Sunset' }
 * ```
 */
export function detailsPatch(state: DetailsState, image: boolean): Record<string, unknown> {
  return image ? { ...state } : { description: state.description };
}

/**
 * A URL with `version` appended as a query parameter, so a replaced file's bytes bypass the cache.
 *
 * @example
 * ```ts
 * versionedURL('/uploads/a.jpg', 7)       // -> '/uploads/a.jpg?v=7'
 * versionedURL('/uploads/a.jpg?w=100', 7) // -> '/uploads/a.jpg?w=100&v=7'
 * ```
 */
export function versionedURL(url: string, version: number): string {
  return `${url}${url.includes('?') ? '&' : '?'}v=${version}`;
}

/**
 * The transform tokens of a variant URL: the segment right before `/` + `path`.
 * `''` when the URL does not end with `/` + `path`.
 *
 * @example
 * ```ts
 * variantTokens('https://img.test/sig/w_320,f_webp/photos/a.jpg', 'photos/a.jpg') // -> 'w_320,f_webp'
 * variantTokens('https://img.test/sig/w_320,f_webp/other.jpg', 'photos/a.jpg')    // -> ''
 * ```
 */
export function variantTokens(url: string, path: string): string {
  const tail = `/${path}`;
  if (!url.endsWith(tail)) return '';
  const head = url.slice(0, -tail.length);
  return basename(head);
}

/**
 * The clamped, three-decimal fraction `offset` is of `size`; `0` for a surface without extent.
 */
function focalFraction(offset: number, size: number): number {
  if (size <= 0) return 0;
  return Math.round(clamp(offset / size, 0, 1) * 1000) / 1000;
}
