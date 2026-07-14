import type { FieldErrors } from '../write/errors.ts';

import { mapKeys } from '../../../utils/index.ts';

/**
 * Joins a path prefix to a nested key, the one rule every composite descent shares.
 *
 * An empty key names the prefix itself, so a failure on the item as a whole keeps the prefix's path.
 * A key opening with `[` concatenates bare, so an array index rides straight onto its field.
 * Any other key joins with a dot.
 *
 * @example
 * ```ts
 * prefixPath('sections', '[0]')      // -> 'sections[0]'
 * prefixPath('sections[0]', 'title') // -> 'sections[0].title'
 * prefixPath('meta', '')             // -> 'meta'
 * ```
 */
export function prefixPath(prefix: string, key: string): string {
  if (key === '') return prefix;
  if (key.startsWith('[')) return `${prefix}${key}`;
  return `${prefix}.${key}`;
}

/**
 * Re-keys an error slice under a path prefix, applying `prefixPath` to every key.
 *
 * @example
 * ```ts
 * prefixErrors('meta', { title: 'This field is required' })
 * // -> { 'meta.title': 'This field is required' }
 * ```
 */
export function prefixErrors(prefix: string, errors: FieldErrors): FieldErrors {
  return mapKeys(errors, (key) => prefixPath(prefix, key as string));
}
