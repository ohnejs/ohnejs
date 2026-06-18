import type { ANSIColors } from '../../ansi/pick-ansi-colors.ts';

import { clamp } from '../../number/clamp.ts';

/**
 * One selectable entry in a `select` or `multiselect` list.
 */
export interface SelectOption<T> {
  /**
   * The value resolved when this entry is chosen.
   */
  value: T;

  /**
   * Text shown for the entry.
   * Falls back to the stringified value.
   */
  label?: string;

  /**
   * Dim note shown after the label while the entry is focused.
   */
  hint?: string;
}

/**
 * The text shown for an option: its `label`, or the stringified value when none is set.
 *
 * @example
 * ```ts
 * optionLabel({ value: 'ts', label: 'TypeScript' }) // -> 'TypeScript'
 * optionLabel({ value: 42 })                        // -> '42'
 * ```
 */
export function optionLabel<T>(option: SelectOption<T>): string {
  return option.label ?? String(option.value);
}

/**
 * Computes the visible window over a list so the cursor stays in view.
 * Returns the full range when `max` covers the list; otherwise a `max`-wide slice centered on the cursor.
 *
 * @example
 * ```ts
 * optionWindow(3, 0, 10) // -> { start: 0, end: 3 }
 * optionWindow(7, 5, 3)  // -> { start: 4, end: 7 }
 * ```
 */
export function optionWindow(
  count: number,
  cursor: number,
  max: number,
): { start: number; end: number } {
  if (max >= count) return { start: 0, end: count };
  const start = clamp(cursor - Math.floor(max / 2), 0, count - max);
  return { start, end: start + max };
}

/**
 * Renders the option rows of a list as railed lines, windowed around the cursor.
 * Each row comes from `renderRow`.
 * A clipped top or bottom row collapses to a dim ellipsis, except the cursor row, which keeps its option.
 * Pass `rail` to override the leading glyph, for example a red rail under an error.
 *
 * @example
 * ```ts
 * optionListBody(5, 0, 3, colors, (i) => labels[i])
 * // -> '│  A\n│  B\n│  …'
 * ```
 */
export function optionListBody(
  count: number,
  cursor: number,
  max: number,
  colors: ANSIColors,
  renderRow: (index: number) => string,
  rail: string = colors.dim('│'),
): string {
  const { start, end } = optionWindow(count, cursor, max);
  const lines: string[] = [];
  for (let i = start; i < end; i += 1) {
    const clipped = (i === start && start > 0) || (i === end - 1 && end < count);
    const content = clipped && i !== cursor ? colors.dim('…') : renderRow(i);
    lines.push(`${rail}  ${content}`);
  }
  return lines.join('\n');
}
