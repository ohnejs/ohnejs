import {
  checkDuration,
  isUndefined,
  parseWholeDuration,
  stringifyDuration,
} from '../../../utils/index.ts';
import { defineField } from '../define-field.ts';
import { option } from '../option.ts';
import { failureMessage } from '../validation-message.ts';

/**
 * The built-in `duration` field type: a length of time, stored as whole milliseconds.
 * Writes, reads, and `where` carry the plain integer; the dashboard reads and writes text like `1h 30m`.
 * `min` and `max` take milliseconds or duration text, and `min` defaults to `0`, so no duration is negative.
 * Search is off until a field sets `search: true`; then a token like `90m` matches the equal duration.
 */
export const duration = defineField({
  columnType: 'integer',
  options: {
    /**
     * The shortest legal duration, as milliseconds or text like `'5m'`.
     *
     * @default
     * 0
     */
    min: option<number | string>({ default: 0 }),

    /**
     * The longest legal duration, as milliseconds or text like `'2h'`.
     */
    max: option<number | string>(),
  },
  validateOptions: ({ options }) => durationBoundsProblem(options),
  validators: [(value, ctx) => failureMessage(checkDuration(value, ctx.options))],
  search: {
    default: false,
    match: ({ token }) => {
      const ms = parseWholeDuration(token);
      return isUndefined(ms) ? null : { equalsTo: ms };
    },
  },
});

/**
 * What makes a field's `min` or `max` unusable, as error body rows, or `undefined` when they hold.
 */
function durationBoundsProblem(options: {
  min: number | string;
  max?: number | string;
}): string[] | undefined {
  for (const key of ['min', 'max'] as const) {
    const bound = options[key];
    if (!isUndefined(bound) && isUndefined(parseWholeDuration(bound))) {
      return [
        `\`${key}\` is \`${String(bound)}\`, which is no duration.`,
        "Write it as whole milliseconds or as text like `'1h 30m'`.",
      ];
    }
  }
  const min = parseWholeDuration(options.min)!;
  const max = parseWholeDuration(options.max);
  if (isUndefined(max) || min <= max) return undefined;
  return [
    `\`min\` is \`${stringifyDuration(min)}\`, above \`max\` \`${stringifyDuration(max)}\`, so no value can pass.`,
    'Swap them, or lower `min`.',
  ];
}
