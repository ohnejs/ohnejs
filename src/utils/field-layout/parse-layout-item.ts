import { isUndefined } from '../is/is-undefined.ts';

/**
 * Splits a layout item into its field name and width.
 * The width is whatever follows the `|`, trimmed; an item without one has no `width`.
 *
 * @example
 * ```ts
 * parseLayoutItem('title')        // -> { name: 'title' }
 * parseLayoutItem('price | 8rem') // -> { name: 'price', width: '8rem' }
 * parseLayoutItem('body |')       // -> { name: 'body' }
 * ```
 */
export function parseLayoutItem(item: string): { name: string; width?: string } {
  const [name = '', width] = item.split('|').map((part) => part.trim());
  return isUndefined(width) || width === '' ? { name } : { name, width };
}
