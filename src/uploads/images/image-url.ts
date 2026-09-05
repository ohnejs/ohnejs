import { isNullish, isUndefined, mimeTypeFor, parseMediaType } from 'ohne/utils';

import type { UploadLocation } from '../uploads/path.ts';
import type { ImageTransforms } from './transforms.ts';

import { useUploadsConfig } from '../config.ts';
import { uploadPath } from '../uploads/path.ts';
import { uploadURL } from '../uploads/url.ts';
import { imageSecrets, signImageVariant } from './sign.ts';
import { stringifyImageTransforms } from './transforms.ts';

/**
 * An upload an image URL is built for: its location, and what the row knows about the image.
 * A record straight from a read fits; so does a hand-built location with a name.
 */
export interface ImageSource extends UploadLocation {
  /**
   * The media type; omitted, the extension names it.
   */
  type?: string | null;

  /**
   * The focal point's horizontal position, fed to the service when the transforms name no position.
   */
  focalX?: number | null;

  /**
   * The focal point's vertical position.
   */
  focalY?: number | null;
}

/**
 * The media types the image service renders variants of.
 */
export const OPTIMIZABLE_IMAGE_TYPES: readonly string[] = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/svg+xml',
];

/**
 * The transforms behind every `thumbnail`: fits within a 320 pixel square, encoded as WebP.
 */
export const THUMBNAIL_TRANSFORMS: ImageTransforms = {
  width: 320,
  height: 320,
  fit: 'inside',
  format: 'webp',
};

const TRAILING_SLASHES = /\/+$/;

/**
 * Whether the image service renders variants of `type`.
 *
 * @example
 * ```ts
 * isOptimizableImage('image/png')      // -> true
 * isOptimizableImage('application/pdf') // -> false
 * ```
 */
export function isOptimizableImage(type: string): boolean {
  return OPTIMIZABLE_IMAGE_TYPES.includes(parseMediaType(type).type);
}

/**
 * Whether variant URLs can be built: `uploads.images.url` is set and `IMAGES_SECRET` holds a secret.
 * Without both, every image URL points at the original.
 */
export function hasImageService(): boolean {
  return !isUndefined(useUploadsConfig().images) && imageSecrets().length > 0;
}

/**
 * The signed image service URL of a variant, or the original's URL when there is nothing to render.
 *
 * The original is answered when no service is configured or when the transforms ask for nothing.
 * It is also answered for a type the service does not render.
 * A focal point stored on the upload fills the position when the transforms name none.
 * The signature covers `{transforms}/{path}` under the first `IMAGES_SECRET`; see `docs/uploads/images.md`.
 *
 * @example
 * ```ts
 * imageURL(upload, { width: 800, format: 'webp' })
 * // -> 'https://img.example.com/2Obrt.../w_800,f_webp/photos/sunset.jpg'
 *
 * imageURL(upload)
 * // -> '/uploads/photos/sunset.jpg'
 * ```
 */
export function imageURL(upload: ImageSource, transforms: ImageTransforms = {}): string {
  const { images } = useUploadsConfig();
  const [secret] = imageSecrets();
  if (isUndefined(images) || isUndefined(secret)) return uploadURL(upload);
  const type = upload.type ?? mimeTypeFor(upload.name) ?? '';
  if (!isOptimizableImage(type)) return uploadURL(upload);
  const tokens = stringifyImageTransforms(withFocalPoint(upload, transforms));
  if (tokens === '') return uploadURL(upload);
  const path = uploadPath(upload);
  const base = images.url.replace(TRAILING_SLASHES, '');
  return `${base}/${signImageVariant(tokens, path, secret)}/${tokens}/${path}`;
}

/**
 * A `srcset` over `widths`, one signed variant per width with a `w` descriptor.
 *
 * @example
 * ```ts
 * imageSrcSet(upload, [400, 800])
 * // -> 'https://img.test/.../w_400/sunset.jpg 400w, https://img.test/.../w_800/sunset.jpg 800w'
 * ```
 */
export function imageSrcSet(
  upload: ImageSource,
  widths: readonly number[],
  transforms: ImageTransforms = {},
): string {
  return widths
    .map((width) => `${imageURL(upload, { ...transforms, width })} ${width}w`)
    .join(', ');
}

/**
 * The signed URL of an upload's thumbnail, the small preview the dashboard grid shows.
 * Falls back to the original exactly as `imageURL` does.
 *
 * @example
 * ```ts
 * thumbnailURL(upload) // -> 'https://img.example.com/.../w_320,h_320,fit_inside,f_webp/photos/sunset.jpg'
 * ```
 */
export function thumbnailURL(upload: ImageSource): string {
  return imageURL(upload, THUMBNAIL_TRANSFORMS);
}

/**
 * The transforms with the upload's focal point filled in when they name no position of their own.
 */
function withFocalPoint(upload: ImageSource, transforms: ImageTransforms): ImageTransforms {
  const { focalX, focalY } = upload;
  if (!isUndefined(transforms.focalPoint) || !isUndefined(transforms.position)) return transforms;
  if (isNullish(focalX) || isNullish(focalY)) return transforms;
  return { ...transforms, focalPoint: { x: focalX, y: focalY } };
}
