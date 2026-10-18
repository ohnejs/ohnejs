import type { FieldInstance } from '../field.ts';

import {
  checkSpan,
  coerceToNumber,
  isInteger,
  isoDayToMs,
  isoTimeToMs,
  isPlainObject,
  isString,
  isTimezone,
  isUndefined,
  parseWholeDuration,
  stringifyDuration,
} from '../../../utils/index.ts';
import { boundsProblem } from '../bounds.ts';
import { defineField } from '../define-field.ts';
import { field } from '../field.ts';
import { option } from '../option.ts';
import { failureMessage } from '../validation-message.ts';

/**
 * The kind of moment both ends of a range hold.
 */
export type RangeKind = 'date' | 'dateTime' | 'time';

const KINDS: readonly RangeKind[] = ['date', 'dateTime', 'time'];
const DAY = 86_400_000;

/**
 * The built-in `range` field type: a `start` and an `end` of one temporal kind, stored once per parent row.
 * It stores as an `object` with the two parts, each a field of the `of` type, and sorts by its `start`.
 * Writes take the whole `{ start, end }`; the start must not lie after the end.
 * A span is `end - start`: a same-day `date` range spans `0`, a `dateTime` one counts real milliseconds.
 */
export const range = defineField({
  columnType: false,
  options: {
    /**
     * The kind of both ends: a `date` day, a `dateTime` instant, or a `time` of day.
     */
    of: option<RangeKind>({ required: true }),

    /**
     * The earliest legal start, in the form the `of` type takes for its own `min`.
     */
    min: option<number | string>(),

    /**
     * The latest legal end, in the form the `of` type takes for its own `max`.
     */
    max: option<number | string>(),

    /**
     * The shortest legal span from start to end, as milliseconds or text like `'1 day'`.
     */
    minSpan: option<number | string>(),

    /**
     * The longest legal span from start to end, as milliseconds or text like `'2 weeks'`.
     */
    maxSpan: option<number | string>(),

    /**
     * Lets the end stay `null`, for a range that has begun but not ended.
     *
     * @default
     * false
     */
    open: option({ default: false }),

    /**
     * The IANA time zone the dashboard shows and edits a `dateTime` range in, like `Europe/Berlin`.
     * Omitted, the viewer's own time zone setting applies.
     */
    timezone: option<string>(),
  },
  schema: ({ options }) => ({
    kind: 'child',
    cardinality: 'one',
    orderBy: 'start',
    subfields: {
      start: rangeEnd(options, 'dashboard.range.start', false),
      end: rangeEnd(options, 'dashboard.range.end', options.open),
    },
  }),
  validateOptions: ({ options }) => rangeOptionsProblem(options),
  validators: [
    (value, ctx) => {
      if (!isPlainObject(value)) return undefined;
      const start = endMs(value.start, ctx.options.of);
      const end = endMs(value.end, ctx.options.of);
      if (isUndefined(start) || isUndefined(end)) return undefined;
      return failureMessage(
        checkSpan(start, end, { min: ctx.options.minSpan, max: ctx.options.maxSpan }),
      );
    },
  ],
});

/**
 * One end of a range: a field of its `of` type, carrying the range's bounds and, for instants, its zone.
 */
function rangeEnd(
  options: { of: RangeKind; min?: number | string; max?: number | string; timezone?: string },
  label: string,
  nullable: boolean,
): FieldInstance {
  const { min, max, timezone } = options;
  // Codegen walks the ends before `validateOptions` runs, so an unknown `of` must still name a real type.
  const of = KINDS.includes(options.of) ? options.of : 'date';
  if (of === 'dateTime') return field('dateTime', { min, max, timezone, nullable, label });
  return field(of, { min: min as string, max: max as string, nullable, label });
}

/**
 * An end as milliseconds on its kind's own line, or `undefined` when it is absent or malformed.
 * An instant reads as its integer column would take it, so a numeric string compares as its number.
 */
function endMs(value: unknown, of: RangeKind): number | undefined {
  if (of === 'dateTime') {
    const ms = coerceToNumber(value);
    return isInteger(ms) ? ms : undefined;
  }
  if (!isString(value)) return undefined;
  return of === 'date' ? isoDayToMs(value) : isoTimeToMs(value);
}

/**
 * What makes a range's options unusable, as error body rows, or `undefined` when they hold.
 * Each end checks `min` and `max` itself, as a field of the `of` type.
 */
function rangeOptionsProblem(options: {
  of: RangeKind;
  minSpan?: number | string;
  maxSpan?: number | string;
  open: boolean;
  timezone?: string;
}): string[] | undefined {
  const { of, minSpan, maxSpan, open, timezone } = options;
  if (!KINDS.includes(of)) {
    return [
      `\`of\` is \`${String(of)}\`, which is no range kind.`,
      'Use `date`, `dateTime` or `time`.',
    ];
  }
  const spans = boundsProblem(options, {
    names: ['minSpan', 'maxSpan'],
    parse: parseWholeDuration,
    form: "whole milliseconds or text like `'1 day'`",
  });
  if (!isUndefined(spans)) return spans;
  if (of === 'date') {
    for (const [name, bound] of [
      ['minSpan', minSpan],
      ['maxSpan', maxSpan],
    ] as const) {
      const ms = parseWholeDuration(bound);
      if (!isUndefined(ms) && ms % DAY !== 0) {
        return [
          `\`${name}\` is \`${stringifyDuration(ms)}\`, but a \`date\` range spans whole days.`,
          "Write it in days, like `'1d'`.",
        ];
      }
    }
  }
  if (open && of === 'time') {
    return ['A `time` range cannot be `open`: it starts and ends on the same day.', 'Drop `open`.'];
  }
  if (open && !isUndefined(maxSpan)) {
    return [
      'An `open` range can leave its end out, so `maxSpan` could never hold.',
      'Drop `open` or `maxSpan`.',
    ];
  }
  if (!isUndefined(timezone) && of !== 'dateTime') {
    return [
      `\`timezone\` applies to a \`dateTime\` range only, and this one is \`${of}\`.`,
      'Drop `timezone`.',
    ];
  }
  if (!isUndefined(timezone) && !isTimezone(timezone)) {
    return [
      `\`timezone\` is \`${timezone}\`, which is no IANA time zone.`,
      'Use a name like `Europe/Berlin`.',
    ];
  }
  return undefined;
}
