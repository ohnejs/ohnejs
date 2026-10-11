import { deepStrictEqual, strictEqual } from 'node:assert';
import { before, describe, it } from 'node:test';

import { formatDatePattern } from '../../../src/utils/i18n/format-date-pattern.ts';
import { formatMessage } from '../../../src/utils/i18n/format-message.ts';
import { formatRelativeTime } from '../../../src/utils/i18n/format-relative-time.ts';
import { deriveIntlData, intlData, registerIntlData } from '../../../src/utils/i18n/intl-data.ts';
import { intlLanguage } from '../../../src/utils/i18n/intl-language.ts';
import { effect } from '../../../src/utils/reactive/effect.ts';

const MINUTE = 60_000;
const SUNDAY = Date.UTC(2026, 9, 11, 12);

const Native = Intl.DateTimeFormat;

/**
 * Makes `Intl.DateTimeFormat` answer CLDR root placeholders for `bs`, as a browser without its data does.
 */
function withoutBosnian(): void {
  const Stub = function (locales?: string | string[], options?: Intl.DateTimeFormatOptions) {
    const tag = Array.isArray(locales) ? locales[0] : locales;
    if (tag !== 'bs') return new Native(tag, options);
    return { format: () => 'M09' };
  } as unknown as typeof Intl.DateTimeFormat;
  Stub.supportedLocalesOf = Native.supportedLocalesOf;
  Intl.DateTimeFormat = Stub;
}

describe('deriveIntlData', () => {
  it('maps a preset onto ohne tokens, literals escaped', () => {
    deepStrictEqual(deriveIntlData('en').presets, {
      L: 'MM[/]DD[/]YYYY',
      l: 'M[/]D[/]YYYY',
      LL: 'MMMM[ ]D[, ]YYYY',
      ll: 'MMM[ ]D[, ]YYYY',
      LT: 'h[:]mm[ ]A',
      LTS: 'h[:]mm[:]ss[ ]A',
    });
  });

  it('keeps a template per plural category and the count-free phrases', () => {
    deepStrictEqual(deriveIntlData('bs').relative.day, {
      past: { one: 'prije # dan', few: 'prije # dana', other: 'prije # dana' },
      future: { one: 'za # dan', few: 'za # dana', other: 'za # dana' },
      auto: { '-1': 'jučer', '0': 'danas', '1': 'sutra' },
    });
  });

  it('reads the separators', () => {
    deepStrictEqual(deriveIntlData('bs').number, { decimal: ',', group: '.' });
  });
});

describe('registerIntlData', () => {
  before(() => {
    const bosnian = deriveIntlData('bs');
    withoutBosnian();
    strictEqual(intlLanguage('bs'), undefined);
    registerIntlData('bs', bosnian);
  });

  it('renders names and presets of a language the engine lacks', () => {
    strictEqual(
      formatDatePattern(SUNDAY, 'dddd, D. MMMM YYYY LL', { language: 'bs', timeZone: 'UTC' }),
      'nedjelja, 11. oktobar 2026 11. oktobar 2026.',
    );
  });

  it('words a relative span of a language the engine lacks', () => {
    strictEqual(formatRelativeTime(SUNDAY - 26 * MINUTE, SUNDAY, 'bs'), 'prije 26 minuta');
    strictEqual(formatRelativeTime(SUNDAY - 2 * MINUTE, SUNDAY, 'bs'), 'prije 2 minute');
    strictEqual(formatRelativeTime(SUNDAY + 3 * 86_400_000, SUNDAY, 'bs'), 'za 3 dana');
    strictEqual(formatRelativeTime(SUNDAY - 86_400_000, SUNDAY, 'bs'), 'jučer');
  });

  it('swaps the number separators of a language the engine lacks', () => {
    strictEqual(formatMessage('{n, number}', { n: 12_345.6 }, 'bs'), '12.345,6');
  });

  it('wakes a reader when data arrives', () => {
    const seen: (string | undefined)[] = [];
    effect(() => {
      seen.push(intlData('xx')?.dayPeriods[0]);
    });
    registerIntlData('xx', deriveIntlData('en'));
    deepStrictEqual(seen, [undefined, 'AM']);
  });
});
