import type { Message } from '../messages/known-messages.ts';

import { isInteger, isRealNumber, isUndefined } from '../../utils/index.ts';
import { option } from './option.ts';

/**
 * The options `number` and `integer` share: bounds, a value grid, a unit label, and the editor.
 */
export const numericOptions = {
  /**
   * The smallest legal value.
   */
  min: option<number>(),

  /**
   * The largest legal value.
   */
  max: option<number>(),

  /**
   * The grid values must lie on: `min + k * step`, or `k * step` without `min`.
   * Every write is checked, exactly in decimal, so `0.3` lies on a `0.1` grid and `0.1 + 0.2` does not.
   * The dashboard's arrow keys and slider move by it.
   */
  step: option<number>(),

  /**
   * A fixed unit label the dashboard shows after the value, like `'kg'`.
   * Pass a message key to translate it per the viewer's language.
   * It never agrees with the number in plural forms.
   *
   * @example
   * ```ts
   * 'min'
   * 'app.units.minutes'
   * ```
   */
  suffix: option<Message>(),

  /**
   * The control the dashboard edits the value with.
   * `'slider'` adds a range track beside the input, so the field needs `min` and `max`.
   * Presentation only: the stored value is a plain number either way.
   *
   * @default
   * 'input'
   */
  display: option<'input' | 'slider'>({ default: 'input' }),
};

/**
 * What makes a numeric field's `step` or `display` unusable, as error body rows, or `undefined` if they hold.
 * A `whole` field holds integers, so its grid, or its slider's, must stay on whole numbers.
 * A slider needs a range, and on a fractional field a grid too.
 */
export function numericOptionsProblem(
  options: { min?: number; max?: number; step?: number; display: 'input' | 'slider' },
  rule: { whole: boolean },
): string[] | undefined {
  const { min, max, step, display } = options;
  if (!isUndefined(step) && (!isRealNumber(step) || step <= 0)) {
    return [
      `\`step\` is \`${String(step)}\`, but it must be a positive number.`,
      'Set a `step` above `0`, like `0.5`.',
    ];
  }
  if (rule.whole && !isUndefined(step) && !isInteger(step)) {
    return [
      `\`step\` is \`${step}\`, but an \`integer\` field holds whole numbers only.`,
      'Use a whole `step`, like `5`.',
    ];
  }
  const gridded = !isUndefined(step) || display === 'slider';
  if (rule.whole && gridded && !isUndefined(min) && !isInteger(min)) {
    return [
      `\`min\` is \`${min}\`, so the grid it starts holds no whole number.`,
      'Use a whole `min`.',
    ];
  }
  if (
    display !== 'slider' ||
    (!isUndefined(min) && !isUndefined(max) && (rule.whole || !isUndefined(step)))
  ) {
    return undefined;
  }
  return rule.whole
    ? [
        "`display: 'slider'` needs `min` and `max`.",
        'Set the range the slider spans, like `min: 0, max: 10`.',
      ]
    : [
        "`display: 'slider'` on a `number` field needs `min`, `max` and `step`.",
        'Set the range and grid the slider spans, like `min: 0, max: 5, step: 0.5`.',
      ];
}
