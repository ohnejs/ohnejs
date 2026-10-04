import { isASCII } from '../is/is-ascii.ts';

const LETTERS: Record<string, string> = {
  ß: 'ss',
  ø: 'o',
  æ: 'ae',
  œ: 'oe',
  đ: 'd',
  ł: 'l',
  ı: 'i',
  ð: 'd',
  þ: 'th',
  ς: 'σ',
};

const KEPT: Record<string, string> = { й: '\uE000', ї: '\uE001', ў: '\uE002' };

const RESTORED: Record<string, string> = { '\uE000': 'й', '\uE001': 'ї', '\uE002': 'ў' };

/**
 * Folds text for a comparison that ignores case and accents.
 * Compatibility forms unfold, the Latin accents U+0300 to U+036F drop, and every script lowercases.
 * Letters with no separable accent map to their plain spelling, and a final `ς` reads as `σ`.
 * Marks outside the Latin accents stay, so kana voicing, Hangul syllables, and Indic vowel signs still count.
 * The Cyrillic letters `й`, `ї`, and `ў` are letters of their own, so they keep their marks; `ё` reads as `е`.
 * Pure ASCII only lowercases.
 *
 * Lowercasing never depends on the locale, so `İ` and `ı` both fold to `i`.
 * The fold can change the length, so a position in folded text never maps back onto the original.
 *
 * @example
 * ```ts
 * foldCase('Café')     // -> 'cafe'
 * foldCase('Straße')   // -> 'strasse'
 * foldCase('İstanbul') // -> 'istanbul'
 * foldCase('ΣΟΦΙΑΣ')   // -> 'σοφιασ'
 * ```
 */
export function foldCase(text: string): string {
  if (isASCII(text)) return text.toLowerCase();
  return text
    .normalize('NFC')
    .replace(/[ЙЇЎйїў]/g, (letter) => KEPT[letter.toLowerCase()])
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/[ßøæœđłıðþς]/g, (letter) => LETTERS[letter])
    .replace(/[\uE000-\uE002]/g, (letter) => RESTORED[letter]);
}
