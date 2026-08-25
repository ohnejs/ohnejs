import { toArray } from '../array/to-array.ts';
import { dotGet } from '../dot-notation/dot-get.ts';
import { isString } from '../is/is-string.ts';
import { isUndefined } from '../is/is-undefined.ts';

/**
 * Filters `array` down to the items matching every keyword, sorted by descending relevance.
 * A keyword string is lowercased and split on spaces; a keyword array is only lowercased.
 * Each matched keyword adds `length / (position + 1)` to the item's score, so early hits rank higher.
 * With no keywords at all, every item is kept in its original order.
 *
 * With `props`, the searched text is the item's property values (dot paths) joined with spaces, lowercased.
 * Without `props`, each item itself is the searched text, matched as given.
 * Lowercase bare string items for a case-insensitive search.
 *
 * @example
 * ```ts
 * searchByKeywords(['foo', 'bar'], 'FOO')                            // -> ['foo']
 * searchByKeywords(['bar foo', 'foo'], 'foo')                        // -> ['foo', 'bar foo']
 * searchByKeywords([{ name: 'foo' }, { name: 'bar' }], 'fo', 'name') // -> [{ name: 'foo' }]
 * searchByKeywords(['foo', 'bar'], '')                               // -> ['foo', 'bar']
 * ```
 */
export function searchByKeywords<T>(
  array: readonly T[],
  keywords: string | readonly string[],
  props?: string | readonly string[],
): T[] {
  const parsed = (
    isString(keywords)
      ? keywords
          .split(' ')
          .map((keyword) => keyword.trim())
          .filter(Boolean)
      : keywords
  ).map((keyword) => keyword.toLowerCase());

  return array
    .map((item) => {
      const text = isUndefined(props)
        ? (item as string)
        : toArray(props)
            .map((prop) => dotGet(item, prop))
            .join(' ')
            .toLowerCase();
      let score = 0.1;
      if (parsed.length) {
        score = 0;
        for (const keyword of parsed) {
          const index = text.indexOf(keyword);
          if (index === -1) {
            score = 0;
            break;
          }
          score += keyword.length / (index + 1);
        }
      }
      return { item, score };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .map(({ item }) => item);
}
