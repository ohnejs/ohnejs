import { isNull } from '../is/is-null.ts';
import { isUndefined } from '../is/is-undefined.ts';

/**
 * Options for `linePath`.
 */
export interface LinePathOptions {
  /**
   * Whether the step from `index` to the next is drawn.
   * A step left out breaks the line, and the next drawn step starts it again.
   * Omitted draws every step between two values.
   */
  joins?: (index: number) => boolean;

  /**
   * A y the path closes down to under every run of the line, so it fills as an area.
   */
  baseline?: number;
}

/**
 * An SVG path through `values` at `x(index)` and `y(value)`.
 * A `null` value is a gap: the line breaks there instead of dropping to zero.
 * A value with no drawn step on either side draws nothing, so plot a dot for it yourself.
 *
 * @example
 * ```ts
 * const x = (index: number) => index * 10
 * const y = (value: number) => 10 - value
 *
 * linePath([1, 2, 3], x, y)                            // -> 'M0,9L10,8L20,7'
 * linePath([1, 2, null, 4, 5], x, y)                   // -> 'M0,9L10,8M30,6L40,5'
 * linePath([1, 2, 3], x, y, { joins: (i) => i !== 1 }) // -> 'M0,9L10,8'
 * linePath([1, 2], x, y, { baseline: 10 })             // -> 'M0,9L10,8L10,10L0,10Z'
 * ```
 */
export function linePath(
  values: readonly (number | null)[],
  x: (index: number) => number,
  y: (value: number) => number,
  options: LinePathOptions = {},
): string {
  const { baseline, joins } = options;
  let path = '';
  let start: number | null = null;
  const close = (end: number): void => {
    if (isNull(start) || isUndefined(baseline)) return;
    path += `L${x(end)},${baseline}L${x(start)},${baseline}Z`;
  };
  for (let index = 0; index < values.length - 1; index += 1) {
    const from = values[index] ?? null;
    const to = values[index + 1] ?? null;
    if (isNull(from) || isNull(to) || joins?.(index) === false) {
      close(index);
      start = null;
      continue;
    }
    if (isNull(start)) {
      start = index;
      path += `M${x(index)},${y(from)}`;
    }
    path += `L${x(index + 1)},${y(to)}`;
  }
  close(values.length - 1);
  return path;
}
