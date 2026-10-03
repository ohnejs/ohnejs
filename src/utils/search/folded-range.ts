import { foldCase } from '../case/fold-case.ts';

/**
 * The first range of `text` that `needle` matches once both fold with `foldCase`, as inclusive start and end.
 * The range is in `text`'s own positions, so a match through an accent or a ligature still points at it.
 * `undefined` when `needle` folds to nothing or does not occur.
 *
 * @example
 * ```ts
 * foldedRange('Crème brûlée', 'brul') // -> [6, 9]
 * foldedRange('Straße', 'strass')     // -> [0, 4]
 * foldedRange('Café', 'tea')          // -> undefined
 * ```
 */
export function foldedRange(text: string, needle: string): [number, number] | undefined {
  const folded = foldCase(needle);
  if (folded === '') return undefined;
  for (let start = 0; start < text.length; start += 1) {
    if (!foldCase(text.slice(start)).startsWith(folded)) continue;
    for (let end = start + 1; end <= text.length; end += 1) {
      if (foldCase(text.slice(start, end)).startsWith(folded)) return [start, end - 1];
    }
  }
  return undefined;
}
