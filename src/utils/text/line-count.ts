/**
 * How many lines `text` holds: one more than its newlines, so `''` is one empty line.
 *
 * @example
 * ```ts
 * lineCount('')       // -> 1
 * lineCount('a')      // -> 1
 * lineCount('a\nb\n') // -> 3
 * ```
 */
export function lineCount(text: string): number {
  let count = 1;
  for (let at = text.indexOf('\n'); at !== -1; at = text.indexOf('\n', at + 1)) count += 1;
  return count;
}
