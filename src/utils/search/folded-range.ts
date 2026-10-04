import { foldCase } from '../case/fold-case.ts';

/**
 * The first range of `text` that `needle` matches once both fold with `foldCase`, as inclusive start and end.
 * The range is in `text`'s own positions, so a match through an accent or a ligature still points at it.
 * A match that starts inside a letter the fold widens covers that whole letter.
 * `undefined` when `needle` folds to nothing or does not occur.
 *
 * @example
 * ```ts
 * foldedRange('Crème brûlée', 'brul') // -> [6, 9]
 * foldedRange('Straße', 'strass')     // -> [0, 4]
 * foldedRange('Straße', 'se')         // -> [4, 5]
 * foldedRange('Café', 'tea')          // -> undefined
 * ```
 */
export function foldedRange(text: string, needle: string): [number, number] | undefined {
  const folded = foldCase(needle);
  if (folded === '') return undefined;
  for (let start = 0; start < text.length; start += 1) {
    const rest = foldCase(text.slice(start));
    for (let skip = 0; skip < Math.max(1, foldCase(text[start]).length); skip += 1) {
      if (!rest.startsWith(folded, skip)) continue;
      for (let end = start + 1; end <= text.length; end += 1) {
        if (foldCase(text.slice(start, end)).startsWith(folded, skip)) return [start, end - 1];
      }
    }
  }
  return undefined;
}
