import { isArray } from '../is/is-array.ts';

/**
 * Options accepted by `slugify`.
 */
export interface SlugifyOptions {
  /**
   * Character used to join words and replace runs of non-alphanumeric input.
   *
   * @default
   * '-'
   */
  separator?: string;

  /**
   * Character map (or ordered list of maps) applied after lowercasing and before NFD diacritic stripping.
   * Later maps see earlier maps' output.
   * Keys must match the lowercased input.
   * Omitted applies no custom mapping.
   */
  replace?: Record<string, string> | Record<string, string>[];
}

/**
 * German digraph map for `slugify`.
 * Maps the umlauts and the eszett to their conventional digraph equivalents.
 * The output stays pronounceable to a German reader.
 *
 * @example
 * ```ts
 * slugify('Übersetzung', { replace: slugGerman }) // -> 'uebersetzung'
 * slugify('Größe',       { replace: slugGerman }) // -> 'groesse'
 * slugify('Straße',      { replace: slugGerman }) // -> 'strasse'
 * ```
 */
export const slugGerman: Record<string, string> = {
  ä: 'ae',
  ö: 'oe',
  ü: 'ue',
  ß: 'ss',
};

/**
 * Bosnian Latin transliteration map for `slugify`.
 * Maps the five letters with diacritics to their bare ASCII equivalents.
 * `đ` is the only one that does not decompose under NFD.
 * The rest are listed explicitly so the intent of the map is visible at a glance.
 *
 * @example
 * ```ts
 * slugify('Šuma',      { replace: slugBosnian }) // -> 'suma'
 * slugify('Đak',       { replace: slugBosnian }) // -> 'dak'
 * slugify('Češljanje', { replace: slugBosnian }) // -> 'cesljanje'
 * ```
 */
export const slugBosnian: Record<string, string> = {
  č: 'c',
  ć: 'c',
  đ: 'd',
  š: 's',
  ž: 'z',
};

/**
 * Converts a string to a URL-friendly slug.
 *
 * Trim and lowercase the input.
 * Apply any `replace` maps in order.
 * NFD-normalize and drop combining marks.
 * Replace non-alphanumeric runs with `separator`.
 * Collapse consecutive separators.
 * Strip leading and trailing separators.
 *
 * `replace` runs before NFD so digraph maps stay meaningful.
 * Without `slugGerman`, `'Übersetzung'` loses its umlaut to NFD and lands on `'ubersetzung'`.
 * With it, `ü -> ue` catches first and the result is `'uebersetzung'`.
 *
 * Non-Latin scripts (Cyrillic, CJK, Arabic, ...) decompose to nothing under NFD and yield an empty slug.
 * Supply a `replace` map to romanize them.
 *
 * @example
 * ```ts
 * slugify('Hello World')                     // -> 'hello-world'
 * slugify('Café au lait')                    // -> 'cafe-au-lait'
 * slugify('  --hello--  ')                   // -> 'hello'
 * slugify('Hello World', { separator: '_' }) // -> 'hello_world'
 *
 * slugify('Übersetzung', { replace: slugGerman })   // -> 'uebersetzung'
 * slugify('Šuma i polje', { replace: slugBosnian }) // -> 'suma-i-polje'
 *
 * slugify('Größe i Đak', { replace: [slugGerman, slugBosnian] })
 * // -> 'groesse-i-dak'
 * ```
 */
export function slugify(value: string, options?: SlugifyOptions): string {
  const separator = options?.separator ?? '-';
  const replace = options?.replace;

  let result = value.trim().toLowerCase();

  if (replace) {
    const maps = isArray<Record<string, string>[]>(replace) ? replace : [replace];
    for (const map of maps) {
      for (const [from, to] of Object.entries(map)) {
        result = result.replaceAll(from, to);
      }
    }
  }

  const stripped = result
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, separator);

  if (separator === '') return stripped;

  const escaped = separator.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return stripped
    .replace(new RegExp(`${escaped}{2,}`, 'g'), separator)
    .replace(new RegExp(`^${escaped}|${escaped}$`, 'g'), '');
}
