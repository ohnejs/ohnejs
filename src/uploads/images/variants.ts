import { errorMessage, hasKey, mapValues } from 'ohnejs/utils';

import type { ImageTransforms } from './transforms.ts';

import { ohneError, type OhneError } from '../../ohne/error/ohne-error.ts';
import { useUploadsConfig } from '../config.ts';
import { stringifyImageTransforms } from './transforms.ts';

/**
 * Codegen extension point for the configured image variant names.
 * Empty until codegen runs; the `image-variants.ts` it emits augments this with one member per variant.
 *
 * `type` aliases cannot be augmented, so the names live on this interface instead.
 *
 * @example
 * ```ts
 * declare module 'ohnejs/uploads' {
 *   interface KnownImageVariants {
 *     thumbnail: true
 *     hero: true
 *   }
 * }
 * ```
 */
export interface KnownImageVariants {}

/**
 * The name of a variant under `uploads.images.variants`.
 * Narrows to the generated union once codegen has run; falls back to `string` until then.
 */
export type ImageVariantName = [keyof KnownImageVariants] extends [never]
  ? string
  : keyof KnownImageVariants & string;

const VARIANT_NAME = /^[a-z][a-zA-Z0-9]*$/;

/**
 * The transforms the variant `name` stands for, as `uploads.images.variants` configures them.
 * An unknown name throws: a variant is server vocabulary, so a typo is a bug.
 *
 * @example
 * ```ts
 * resolveImageVariant('thumbnail') // -> { width: 320, height: 320, fit: 'inside', format: 'webp' }
 * resolveImageVariant('hero')      // throws when no layer defines `hero`
 * ```
 */
export function resolveImageVariant(name: string): ImageTransforms {
  const { variants } = useUploadsConfig().images;
  if (!hasKey(variants, name)) {
    throw ohneError(
      `Unknown image variant \`${name}\`; define it under \`uploads.images.variants\``,
    );
  }
  return variants[name];
}

/**
 * The canonical token string of every configured variant, keyed by name.
 * A service allowlist is built from it: the values are what `IMAGES_VARIANTS` lists.
 *
 * @example
 * ```ts
 * imageVariantTokens() // -> { thumbnail: 'w_320,h_320,fit_inside,f_webp' }
 * ```
 */
export function imageVariantTokens(): Record<string, string> {
  return mapValues(useUploadsConfig().images.variants, (_, transforms) =>
    stringifyImageTransforms(transforms),
  );
}

/**
 * Checks every configured variant, throwing on the first invalid one with its name in the title.
 * A name is a camelCase identifier, and a preset must ask the service for something.
 * The boot file runs it on `server:ready`, so a typo fails the process instead of a page.
 *
 * @example
 * ```ts
 * validateImageVariants() // throws for `Hero: { width: 800 }` or for `card: {}`
 * ```
 */
export function validateImageVariants(): void {
  for (const [name, transforms] of Object.entries(useUploadsConfig().images.variants)) {
    if (!VARIANT_NAME.test(name)) {
      throw invalidVariant(name, [
        'A variant name is a camelCase identifier: a lowercase letter, then letters and digits.',
        'Rename it under `uploads.images.variants`.',
      ]);
    }
    if (tokensOf(name, transforms) === '') {
      throw invalidVariant(name, [
        'Its transforms ask the image service for nothing, so every URL would point at the original.',
        'Give it a `width`, a `height`, or a `format` under `uploads.images.variants`.',
      ]);
    }
  }
}

/**
 * The canonical tokens of a preset, or the throw that names the variant an out-of-range value sits in.
 */
function tokensOf(name: string, transforms: ImageTransforms): string {
  try {
    return stringifyImageTransforms(transforms);
  } catch (error) {
    throw invalidVariant(name, [errorMessage(error), 'Fix it under `uploads.images.variants`.']);
  }
}

/**
 * The one error every invalid variant reports, `body` holding the cause and the fix.
 */
function invalidVariant(name: string, body: string[]): OhneError {
  return ohneError({ title: `Invalid image variant \`${name}\``, body });
}
