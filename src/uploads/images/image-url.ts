import {
  isNullish,
  isString,
  isUndefined,
  mapValues,
  mimeTypeFor,
  parseMediaType,
} from 'ohnejs/utils';

import type { UploadURLSource } from '../uploads/url.ts';
import type { ImageTransforms } from './transforms.ts';
import type { ImageVariantName } from './variants.ts';

import { ohneError } from '../../ohne/error/ohne-error.ts';
import { useUploadsConfig } from '../config.ts';
import { uploadPath } from '../uploads/path.ts';
import { uploadURL } from '../uploads/url.ts';
import { signImageVariant, UNSIGNED_SIGNATURE, uploadSecrets } from './sign.ts';
import { stringifyImageTransforms } from './transforms.ts';
import { resolveImageVariant } from './variants.ts';

/**
 * An upload an image URL is built for: its location, its privacy, and what the row knows about the image.
 * A record straight from a read fits; so does a hand-built location with a name.
 */
export interface ImageSource extends UploadURLSource {
  /**
   * The media type; omitted, the extension names it.
   */
  type?: string | null;

  /**
   * The focal point's horizontal position, fed to the service when a `cover` fit names no position.
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

const TRAILING_SLASHES = /\/+$/;

/**
 * Whether the image service renders variants of `type`.
 *
 * @example
 * ```ts
 * isOptimizableImage('image/png')       // -> true
 * isOptimizableImage('application/pdf') // -> false
 * ```
 */
export function isOptimizableImage(type: string): boolean {
  return OPTIMIZABLE_IMAGE_TYPES.includes(parseMediaType(type).type);
}

/**
 * Whether variant URLs can be built: `uploads.images.url` names a service.
 * Without one, every image URL points at the original.
 */
export function hasImageService(): boolean {
  return !isUndefined(useUploadsConfig().images.url);
}

/**
 * The signed image service URL of a variant, or the original's URL when there is nothing to render.
 *
 * `variant` is a configured name, ad hoc transforms for trusted server code, or nothing for the original.
 * An unknown name throws, with or without a service, so a typo surfaces in every environment.
 * The original is answered when no service is configured or when the transforms ask for nothing.
 * It is also answered for a type the service does not render.
 * A focal point stored on the upload fills the position when a `cover` fit names none.
 * Without an `UPLOADS_SECRET` the signature reads `unsigned`, which only an unsigned service renders.
 * A private image's URLs carry an `e_<expires>` token last and are always signed.
 * Without an `UPLOADS_SECRET` or an `expires` they point at the original instead.
 *
 * @example
 * ```ts
 * imageURL(upload, 'thumbnail')
 * // -> 'https://img.example.com/XxABa.../w_320,h_320,fit_inside,f_webp/photos/sunset.jpg'
 *
 * imageURL(upload, { width: 800, format: 'webp' })
 * // -> 'https://img.example.com/2Obrt.../w_800,f_webp/photos/sunset.jpg'
 *
 * imageURL(upload)
 * // -> '/uploads/photos/sunset.jpg'
 * ```
 */
export function imageURL(
  upload: ImageSource,
  variant: ImageVariantName | ImageTransforms = {},
): string {
  const transforms = isString(variant) ? resolveImageVariant(variant) : variant;
  const { images } = useUploadsConfig();
  if (isUndefined(images.url)) return uploadURL(upload);
  const type = upload.type ?? mimeTypeFor(upload.name) ?? '';
  if (!isOptimizableImage(type)) return uploadURL(upload);
  const tokens = stringifyImageTransforms(withFocalPoint(upload, transforms));
  if (tokens === '') return uploadURL(upload);
  const [secret] = uploadSecrets();
  const signed = tokensToSign(upload, tokens, secret);
  if (isUndefined(signed)) return uploadURL(upload);
  const path = uploadPath(upload);
  const base = images.url.replace(TRAILING_SLASHES, '');
  const signature = isUndefined(secret)
    ? UNSIGNED_SIGNATURE
    : signImageVariant(signed, path, secret);
  return `${base}/${signature}/${signed}/${path}`;
}

/**
 * A `srcset` over `entries`, one signed variant per entry with its `width` as the `w` descriptor.
 * An entry is a configured name or ad hoc transforms; one without a `width` throws.
 *
 * @example
 * ```ts
 * imageSrcSet(upload, ['card', 'cardWide'])
 * // -> 'https://img.test/.../w_400,f_webp/a.jpg 400w, https://img.test/.../w_800,f_webp/a.jpg 800w'
 * ```
 */
export function imageSrcSet(
  upload: ImageSource,
  entries: readonly (ImageVariantName | ImageTransforms)[],
): string {
  return entries.map((entry) => srcSetEntry(upload, entry)).join(', ');
}

/**
 * One signed URL per configured variant, keyed by name: what decoration emits as `variants`.
 * Each URL falls back to the original exactly as `imageURL` does.
 *
 * @example
 * ```ts
 * imageVariantURLs(upload)
 * // -> { thumbnail: 'https://img.example.com/.../w_320,h_320,fit_inside,f_webp/photos/sunset.jpg' }
 * ```
 */
export function imageVariantURLs(upload: ImageSource): Record<string, string> {
  return mapValues(useUploadsConfig().images.variants, (_, transforms) =>
    imageURL(upload, transforms),
  );
}

/**
 * One `srcset` candidate: the entry's signed URL and its `width` as the descriptor.
 */
function srcSetEntry(upload: ImageSource, entry: ImageVariantName | ImageTransforms): string {
  const transforms = isString(entry) ? resolveImageVariant(entry) : entry;
  if (isUndefined(transforms.width)) {
    const subject = isString(entry) ? `Image variant \`${entry}\`` : 'A `srcset` entry';
    throw ohneError(`${subject} has no \`width\`, which the \`w\` descriptor needs`);
  }
  return `${imageURL(upload, transforms)} ${transforms.width}w`;
}

/**
 * The signed segment: `tokens` for a public image, `tokens` with `e_<expires>` last for a private one.
 * `undefined` for a private image nothing can sign, without a secret or an `expires`.
 */
function tokensToSign(
  upload: ImageSource,
  tokens: string,
  secret: string | undefined,
): string | undefined {
  if (upload.private !== true) return tokens;
  if (isUndefined(secret) || isUndefined(upload.expires)) return undefined;
  return `${tokens},e_${upload.expires}`;
}

/**
 * The transforms with the upload's focal point filled in when a `cover` fit names no position of its own.
 */
function withFocalPoint(upload: ImageSource, transforms: ImageTransforms): ImageTransforms {
  const { fit, focalPoint, position } = transforms;
  if (!isUndefined(fit) && fit !== 'cover') return transforms;
  if (!isUndefined(focalPoint) || !isUndefined(position)) return transforms;
  const { focalX, focalY } = upload;
  if (isNullish(focalX) || isNullish(focalY)) return transforms;
  return { ...transforms, focalPoint: { x: focalX, y: focalY } };
}
