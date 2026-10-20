import type { CurrencyCode } from '../../../utils/index.ts';
import type { Message } from '../../messages/known-messages.ts';
import type { FieldInstance } from '../field.ts';

import {
  amountWithCode,
  checkNumberSpan,
  checkSpan,
  coerceToNumber,
  isCurrencyCode,
  isInteger,
  isoDayToMs,
  isoTimeToMs,
  isPlainObject,
  isRealNumber,
  isStepMultiple,
  isString,
  isTimezone,
  isUndefined,
  nonNegativeNumber,
  parseWholeDuration,
  stringifyDuration,
} from '../../../utils/index.ts';
import { boundsProblem } from '../bounds.ts';
import { defineField } from '../define-field.ts';
import { field } from '../field.ts';
import { minorUnitsHint, numericOptionsProblem } from '../numeric.ts';
import { option } from '../option.ts';
import { failureMessage } from '../validation-message.ts';

/**
 * The kind of value both ends of a range hold.
 */
export type RangeKind = 'date' | 'dateTime' | 'time' | 'integer' | 'number';

const KINDS: readonly RangeKind[] = ['date', 'dateTime', 'time', 'integer', 'number'];
const NUMERIC: readonly RangeKind[] = ['integer', 'number'];
const DAY = 86_400_000;

/**
 * The built-in `range` field type: a `start` and an `end` of one kind, stored once per parent row.
 * It stores as an `object` with the two parts, each a field of the `of` type, and sorts by its `start`.
 * Writes take the whole `{ start, end }`; the start must not lie after the end.
 * A span is `end - start`: a same-day `date` range spans `0`, a `dateTime` one counts real milliseconds.
 * A numeric span is the plain difference, in minor units with a `currency`.
 */
export const range = defineField({
  columnType: false,
  options: {
    /**
     * The kind of both ends: a `date`, a `dateTime` instant, a `time` of day, an `integer` or a `number`.
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
     * The shortest legal span from start to end.
     * A temporal range takes milliseconds or text like `'1 day'`, a numeric one a number.
     */
    minSpan: option<number | string>(),

    /**
     * The longest legal span from start to end.
     * A temporal range takes milliseconds or text like `'2 weeks'`, a numeric one a number.
     */
    maxSpan: option<number | string>(),

    /**
     * The grid both ends of a numeric range lie on, as the `of` type takes its own `step`.
     */
    step: option<number>(),

    /**
     * The ISO 4217 currency an `integer` range counts in, as minor units, as the `integer` type takes it.
     */
    currency: option<CurrencyCode>(),

    /**
     * A fixed unit label the dashboard shows after a numeric range, like `'kg'`.
     */
    suffix: option<Message>(),

    /**
     * The control the dashboard edits a numeric range with.
     * `'slider'` adds a two-thumb track above the inputs, so the range needs `min` and `max`.
     *
     * @default
     * 'input'
     */
    display: option<'input' | 'slider'>({ default: 'input' }),

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
      const { of, minSpan, maxSpan, currency } = ctx.options;
      if (NUMERIC.includes(of)) {
        const start = endNumber(value.start, of);
        const end = endNumber(value.end, of);
        if (isUndefined(start) || isUndefined(end)) return undefined;
        const show = isUndefined(currency)
          ? undefined
          : (minor: number) => amountWithCode(minor, currency);
        const bounds = {
          min: minSpan as number | undefined,
          max: maxSpan as number | undefined,
        };
        return failureMessage(checkNumberSpan(start, end, bounds, show));
      }
      const start = endMs(value.start, of);
      const end = endMs(value.end, of);
      if (isUndefined(start) || isUndefined(end)) return undefined;
      return failureMessage(checkSpan(start, end, { min: minSpan, max: maxSpan }));
    },
  ],
});

/**
 * The resolved options of a `range` field, with the `search` its ends may take.
 */
interface RangeOptions {
  of: RangeKind;
  min?: number | string;
  max?: number | string;
  minSpan?: number | string;
  maxSpan?: number | string;
  step?: number;
  currency?: CurrencyCode;
  suffix?: Message;
  display: 'input' | 'slider';
  open: boolean;
  timezone?: string;
  search?: boolean;
}

/**
 * One end of a range: a field of its `of` type, carrying the range's bounds, grid, unit and zone.
 * Only a numeric end takes `search`: a temporal end matches words by its own type's default.
 */
function rangeEnd(options: RangeOptions, label: string, nullable: boolean): FieldInstance {
  const { step, currency, suffix, search, timezone } = options;
  const min = options.min as number;
  const max = options.max as number;
  // Codegen walks the ends before `validateOptions` runs, so an unknown `of` must still name a real type.
  const of = KINDS.includes(options.of) ? options.of : 'date';
  if (of === 'integer') {
    return field('integer', {
      min,
      max,
      step,
      currency,
      suffix,
      search,
      nullable,
      label,
    });
  }
  if (of === 'number') return field('number', { min, max, step, suffix, search, nullable, label });
  if (of === 'dateTime') return field('dateTime', { min, max, timezone, nullable, label });
  return field(of, {
    min: options.min as string,
    max: options.max as string,
    nullable,
    label,
  });
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
 * A numeric end as its column would take it, or `undefined` when it is absent or malformed.
 */
function endNumber(value: unknown, of: RangeKind): number | undefined {
  const number = coerceToNumber(value);
  if (of === 'integer') return isInteger(number) ? number : undefined;
  return isRealNumber(number) ? number : undefined;
}

/**
 * What makes a range's options unusable, as error body rows, or `undefined` when they hold.
 * Each end checks its own bounds, grid and currency, as a field of the `of` type.
 */
function rangeOptionsProblem(options: RangeOptions): string[] | undefined {
  const { of, open, timezone } = options;
  if (!KINDS.includes(of)) {
    return [
      `\`of\` is \`${String(of)}\`, which is no range kind.`,
      'Use `date`, `dateTime`, `time`, `integer` or `number`.',
    ];
  }
  const numeric = NUMERIC.includes(of);
  for (const [name, set, fits, kinds] of [
    ['step', !isUndefined(options.step), numeric, 'an `integer` or `number`'],
    ['suffix', !isUndefined(options.suffix), numeric, 'an `integer` or `number`'],
    ["display: 'slider'", options.display === 'slider', numeric, 'an `integer` or `number`'],
    ['currency', !isUndefined(options.currency), of === 'integer', 'an `integer`'],
    ['timezone', !isUndefined(timezone), of === 'dateTime', 'a `dateTime`'],
  ] as const) {
    if (set && !fits) {
      return [
        `\`${name}\` applies to ${kinds} range only, and this one is \`${of}\`.`,
        `Drop \`${name}\`.`,
      ];
    }
  }
  const problem = numeric ? numericSpanProblem(options) : temporalSpanProblem(options);
  if (!isUndefined(problem)) return problem;
  if (open && of === 'time') {
    return ['A `time` range cannot be `open`: it starts and ends on the same day.', 'Drop `open`.'];
  }
  if (open && !isUndefined(options.maxSpan)) {
    return [
      'An `open` range can leave its end out, so `maxSpan` could never hold.',
      'Drop `open` or `maxSpan`.',
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

/**
 * What makes a temporal range's spans unusable, as error body rows, or `undefined` when they hold.
 */
function temporalSpanProblem(options: RangeOptions): string[] | undefined {
  const spans = boundsProblem(options, {
    names: ['minSpan', 'maxSpan'],
    parse: parseWholeDuration,
    form: "whole milliseconds or text like `'1 day'`",
  });
  if (!isUndefined(spans) || options.of !== 'date') return spans;
  for (const name of ['minSpan', 'maxSpan'] as const) {
    const ms = parseWholeDuration(options[name]);
    if (!isUndefined(ms) && ms % DAY !== 0) {
      return [
        `\`${name}\` is \`${stringifyDuration(ms)}\`, but a \`date\` range spans whole days.`,
        "Write it in days, like `'1d'`.",
      ];
    }
  }
  return undefined;
}

/**
 * What makes a numeric range's spans or slider unusable, as error body rows, or `undefined` when they hold.
 * The range is checked before its ends, so it reads its bounds itself before the slider rules lean on them.
 * A slider keeps its thumbs `minSpan` to `maxSpan` apart, so each must lie on the slider's `step` grid.
 */
function numericSpanProblem(options: RangeOptions): string[] | undefined {
  const { of, currency, display } = options;
  const whole = of === 'integer';
  const spans = boundsProblem(options, {
    names: ['minSpan', 'maxSpan'],
    parse: nonNegativeNumber,
    form: 'a number at or above `0`',
  });
  if (!isUndefined(spans)) return spans;
  for (const name of ['minSpan', 'maxSpan'] as const) {
    const span = options[name];
    if (whole && !isUndefined(span) && !isInteger(span)) {
      return [
        `\`${name}\` is \`${span}\`, but an \`integer\` range spans whole numbers.`,
        isCurrencyCode(currency)
          ? minorUnitsHint(name, currency)
          : `Use a whole \`${name}\`, like \`5\`.`,
      ];
    }
  }
  const { min, max, step } = options as {
    min?: number;
    max?: number;
    step?: number;
  };
  const problem =
    boundsProblem(options) ??
    numericOptionsProblem({ min, max, step, display }, { whole, subject: 'range' });
  if (!isUndefined(problem) || display !== 'slider') return problem;
  const grid = step ?? 1;
  for (const name of ['minSpan', 'maxSpan'] as const) {
    const span = options[name] as number | undefined;
    if (!isUndefined(span) && !isStepMultiple(span, grid)) {
      return [
        `\`${name}\` is \`${span}\`, off the slider's \`step\` of \`${grid}\`.`,
        `Use a multiple of \`${grid}\` for \`${name}\`.`,
      ];
    }
  }
  return undefined;
}
