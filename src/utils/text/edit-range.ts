import { isUndefined } from '../is/is-undefined.ts';

const WORD = /^[\p{L}\p{N}\p{M}_]+$/u;

/**
 * Where, in `after`, the text that the edit turning `before` into it wrote starts and ends.
 * The text both share at their start and at their end is left out, the end never reaching into the start.
 * An edit that only removed text writes an empty range where that text was.
 * The end is where native undo places a caret: behind inserted text, and where removed text was.
 *
 * A `caret` in `before`, where the edit left it, breaks the ties the two texts alone cannot.
 * Beside repeated text an edit has several possible places, and a caret at one of their ends picks it.
 * A caret further along a replaced word widens the replacement to it, so `King` retyped as `Thing` spans it.
 * Any other caret is ignored.
 *
 * @example
 * ```ts
 * editRange('hello big world', 'hello world') // -> { start: 6, end: 6 }
 * editRange('hello world', 'hello big world') // -> { start: 6, end: 10 }
 * editRange('let a = 1', 'let b = 1')         // -> { start: 4, end: 5 }
 *
 * editRange('Yes, You', 'You', 5)             // -> { start: 0, end: 0 }
 * editRange('Lich Thing', 'Lich King', 10)    // -> { start: 5, end: 9 }
 * ```
 */
export function editRange(
  before: string,
  after: string,
  caret?: number,
): { start: number; end: number } {
  const shortest = Math.min(before.length, after.length);
  let start = 0;
  while (start < shortest && before[start] === after[start]) start += 1;
  let shared = 0;
  while (
    shared < shortest &&
    before[before.length - 1 - shared] === after[after.length - 1 - shared]
  ) {
    shared += 1;
  }
  const shift = after.length - before.length;
  const latest = before.length - Math.min(shared, shortest - start);
  const written = latest + shift - start;
  if (isUndefined(caret)) return { start, end: start + written };
  const replaced = latest > start && latest + shift > start;
  const slides = caret >= before.length - shared && caret <= latest;
  const widens =
    replaced &&
    caret > latest &&
    caret <= before.length &&
    WORD.test(before.slice(latest - 1, caret));
  if (slides) return { start: caret + shift - written, end: caret + shift };
  if (widens) return { start, end: caret + shift };
  return { start, end: start + written };
}
