import { isUndefined } from '../is/is-undefined.ts';
import { ref } from '../reactive/ref.ts';

/**
 * A unit `formatRelativeTime` words a span in.
 */
export type IntlRelativeUnit = 'second' | 'minute' | 'hour' | 'day' | 'month' | 'year';

/**
 * A date preset `formatDatePattern` renders in a language's own layout.
 */
export type IntlPreset = 'L' | 'l' | 'LL' | 'll' | 'LT' | 'LTS';

/**
 * The relative-time words of one unit.
 */
export interface IntlRelativeWords {
  /**
   * A span in the past per plural category, `#` standing for the count, like `prije # minuta`.
   */
  past: Partial<Record<Intl.LDMLPluralRule, string>>;

  /**
   * A span in the future per plural category, `#` standing for the count, like `za # minuta`.
   */
  future: Partial<Record<Intl.LDMLPluralRule, string>>;

  /**
   * The phrases that replace a count, keyed by the signed count, like `{ '-1': 'jučer' }`.
   */
  auto: Record<string, string>;
}

/**
 * The `Intl` data the dashboard formats one language with, as plain JSON.
 * The server derives it from its own engine, so a browser that lacks the language still renders it.
 */
export interface IntlData {
  /**
   * The month names, January first.
   * The `format` forms are the ones a full date uses, so a language that declines a month gets it right.
   */
  months: { long: string[]; short: string[]; formatLong: string[]; formatShort: string[] };

  /**
   * The weekday names, Sunday first.
   */
  weekdays: { long: string[]; short: string[] };

  /**
   * The morning and the afternoon day period, like `AM` and `PM`.
   */
  dayPeriods: [am: string, pm: string];

  /**
   * Each preset as an ohne token pattern, like `D. MMMM YYYY[.]`.
   */
  presets: Record<IntlPreset, string>;

  /**
   * The relative-time words per unit.
   */
  relative: Record<IntlRelativeUnit, IntlRelativeWords>;

  /**
   * The number separators.
   */
  number: { decimal: string; group: string };
}

const PRESETS: Record<IntlPreset, Intl.DateTimeFormatOptions> = {
  L: { year: 'numeric', month: '2-digit', day: '2-digit' },
  l: { year: 'numeric', month: 'numeric', day: 'numeric' },
  LL: { year: 'numeric', month: 'long', day: 'numeric' },
  ll: { year: 'numeric', month: 'short', day: 'numeric' },
  LT: { hour: 'numeric', minute: '2-digit' },
  LTS: { hour: 'numeric', minute: '2-digit', second: '2-digit' },
};

const UNITS: readonly IntlRelativeUnit[] = ['second', 'minute', 'hour', 'day', 'month', 'year'];

// Single-digit month, day and hour, so a padded part tells itself apart from a plain one.
const SAMPLE = Date.UTC(2026, 8, 5, 4, 7, 8);

const registry = ref<ReadonlyMap<string, IntlData>>(new Map());

/**
 * Derives a language's `IntlData` from the running engine, which must hold real data for it.
 * Names come from `Intl.DateTimeFormat`, presets from its parts mapped onto ohne tokens.
 * Relative words come from `Intl.RelativeTimeFormat`, one template per plural category.
 *
 * @example
 * ```ts
 * deriveIntlData('bs').presets.LL        // -> 'D[. ]MMMM[ ]YYYY[.]'
 * deriveIntlData('bs').relative.day.auto // -> { '0': 'danas', '1': 'sutra', '-1': 'jučer' }
 * ```
 */
export function deriveIntlData(language: string): IntlData {
  const name = (options: Intl.DateTimeFormatOptions, at: number, type: string): string =>
    new Intl.DateTimeFormat(language, { timeZone: 'UTC', ...options })
      .formatToParts(at)
      .find((part) => part.type === type)?.value ?? '';
  const months = (options: Intl.DateTimeFormatOptions): string[] =>
    Array.from({ length: 12 }, (_, index) => name(options, Date.UTC(2024, index, 15), 'month'));
  const weekdays = (weekday: 'long' | 'short'): string[] =>
    Array.from({ length: 7 }, (_, index) =>
      name({ weekday }, Date.UTC(2024, 0, 7 + index), 'weekday'),
    );
  const hour12 = { hour: 'numeric', hour12: true } as const;
  const data: IntlData = {
    months: {
      long: months({ month: 'long' }),
      short: months({ month: 'short' }),
      formatLong: months({ day: 'numeric', month: 'long' }),
      formatShort: months({ day: 'numeric', month: 'short' }),
    },
    weekdays: { long: weekdays('long'), short: weekdays('short') },
    dayPeriods: [
      name(hour12, Date.UTC(2024, 0, 1, 9), 'dayPeriod'),
      name(hour12, Date.UTC(2024, 0, 1, 21), 'dayPeriod'),
    ],
    presets: {} as Record<IntlPreset, string>,
    relative: {} as Record<IntlRelativeUnit, IntlRelativeWords>,
    number: separators(language),
  };
  for (const key of Object.keys(PRESETS) as IntlPreset[]) {
    data.presets[key] = presetPattern(language, PRESETS[key], data);
  }
  for (const unit of UNITS) data.relative[unit] = relativeWords(language, unit);
  return data;
}

/**
 * Registers a language's `IntlData`, so the formatters render a language the engine lacks.
 * The registry is reactive: a binding that formatted before the data arrived renders again.
 *
 * @example
 * ```ts
 * registerIntlData('bs', await (await fetch('/intl/bs')).json())
 * ```
 */
export function registerIntlData(language: string, data: IntlData): void {
  registry.value = new Map(registry.value).set(language, data);
}

/**
 * Reads a language's registered `IntlData`, `undefined` when none is; the read is reactive.
 *
 * @example
 * ```ts
 * intlData('bs')?.months.long[0] // -> 'januar' once registered
 * ```
 */
export function intlData(language: string): IntlData | undefined {
  return registry.value.get(language);
}

/**
 * A preset rendered at the sample instant, its parts mapped onto ohne tokens and its literals escaped.
 */
function presetPattern(
  language: string,
  options: Intl.DateTimeFormatOptions,
  data: IntlData,
): string {
  const parts = new Intl.DateTimeFormat(language, { timeZone: 'UTC', ...options }).formatToParts(
    SAMPLE,
  );
  const twelve = parts.some((part) => part.type === 'dayPeriod');
  return parts
    .map(({ type, value }) => {
      if (type === 'year') return value.length === 2 ? 'YY' : 'YYYY';
      if (type === 'month') {
        if (/^\d+$/.test(value)) return value.length === 2 ? 'MM' : 'M';
        return value === data.months.formatShort[8] || value === data.months.short[8]
          ? 'MMM'
          : 'MMMM';
      }
      if (type === 'day') return value.length === 2 ? 'DD' : 'D';
      if (type === 'weekday') return value === data.weekdays.long[6] ? 'dddd' : 'ddd';
      if (type === 'hour') return (twelve ? 'h' : 'H').repeat(value.length);
      if (type === 'minute') return 'mm';
      if (type === 'second') return 'ss';
      if (type === 'dayPeriod') return 'A';
      return `[${value}]`;
    })
    .join('');
}

/**
 * One unit's relative words: a template per plural category each way, and the count-free phrases.
 */
function relativeWords(language: string, unit: IntlRelativeUnit): IntlRelativeWords {
  const always = new Intl.RelativeTimeFormat(language, { numeric: 'always' });
  const plural = new Intl.PluralRules(language);
  const template = (value: number): string =>
    always
      .formatToParts(value, unit)
      .map((part) => (part.type === 'integer' ? '#' : part.value))
      .join('')
      .replace(/#+/g, '#');
  const words: IntlRelativeWords = { past: {}, future: {}, auto: {} };
  for (const category of plural.resolvedOptions().pluralCategories) {
    const count = Array.from({ length: 200 }, (_, index) => index).find(
      (index) => plural.select(index) === category,
    );
    if (isUndefined(count)) continue;
    words.past[category] = template(-count);
    words.future[category] = template(count);
  }
  const auto = new Intl.RelativeTimeFormat(language, { numeric: 'auto' });
  for (const value of [-1, 0, 1]) {
    const phrase = auto.format(value, unit);
    if (!/\d/.test(phrase)) words.auto[String(value)] = phrase;
  }
  return words;
}

/**
 * The language's decimal and group separators.
 */
function separators(language: string): IntlData['number'] {
  const parts = new Intl.NumberFormat(language).formatToParts(12_345.6);
  return {
    decimal: parts.find((part) => part.type === 'decimal')?.value ?? '.',
    group: parts.find((part) => part.type === 'group')?.value ?? ',',
  };
}
