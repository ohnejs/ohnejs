import { deepStrictEqual, strictEqual, throws } from 'node:assert';
import { describe, it } from 'node:test';

import { dateOptionsFromSkeleton } from '../../../src/utils/i18n/date-options-from-skeleton.ts';
import { formatMessage } from '../../../src/utils/i18n/format-message.ts';
import { MessageFormatError } from '../../../src/utils/i18n/message-errors.ts';

const opts = dateOptionsFromSkeleton;

describe('dateOptionsFromSkeleton - era', () => {
  it('G / GG / GGG -> short', () => {
    deepStrictEqual(opts('G'), { era: 'short' });
    deepStrictEqual(opts('GG'), { era: 'short' });
    deepStrictEqual(opts('GGG'), { era: 'short' });
  });

  it('GGGG -> long', () => {
    deepStrictEqual(opts('GGGG'), { era: 'long' });
  });

  it('GGGGG -> narrow', () => {
    deepStrictEqual(opts('GGGGG'), { era: 'narrow' });
  });
});

describe('dateOptionsFromSkeleton - year', () => {
  it('y -> numeric', () => {
    deepStrictEqual(opts('y'), { year: 'numeric' });
  });

  it('yy -> 2-digit', () => {
    deepStrictEqual(opts('yy'), { year: '2-digit' });
  });

  it('yyyy -> numeric', () => {
    deepStrictEqual(opts('yyyy'), { year: 'numeric' });
  });

  it('u, U, r are treated as year aliases', () => {
    deepStrictEqual(opts('u'), { year: 'numeric' });
    deepStrictEqual(opts('U'), { year: 'numeric' });
    deepStrictEqual(opts('r'), { year: 'numeric' });
  });
});

describe('dateOptionsFromSkeleton - month', () => {
  it('M -> numeric', () => {
    deepStrictEqual(opts('M'), { month: 'numeric' });
  });

  it('MM -> 2-digit', () => {
    deepStrictEqual(opts('MM'), { month: '2-digit' });
  });

  it('MMM -> short', () => {
    deepStrictEqual(opts('MMM'), { month: 'short' });
  });

  it('MMMM -> long', () => {
    deepStrictEqual(opts('MMMM'), { month: 'long' });
  });

  it('MMMMM -> narrow', () => {
    deepStrictEqual(opts('MMMMM'), { month: 'narrow' });
  });

  it('L is treated as a month alias', () => {
    deepStrictEqual(opts('LLLL'), { month: 'long' });
  });
});

describe('dateOptionsFromSkeleton - day', () => {
  it('d -> numeric', () => {
    deepStrictEqual(opts('d'), { day: 'numeric' });
  });

  it('dd -> 2-digit', () => {
    deepStrictEqual(opts('dd'), { day: '2-digit' });
  });
});

describe('dateOptionsFromSkeleton - weekday', () => {
  it('E / EE / EEE -> short', () => {
    deepStrictEqual(opts('E'), { weekday: 'short' });
    deepStrictEqual(opts('EE'), { weekday: 'short' });
    deepStrictEqual(opts('EEE'), { weekday: 'short' });
  });

  it('EEEE -> long', () => {
    deepStrictEqual(opts('EEEE'), { weekday: 'long' });
  });

  it('EEEEE -> narrow', () => {
    deepStrictEqual(opts('EEEEE'), { weekday: 'narrow' });
  });

  it('e and c are weekday aliases', () => {
    deepStrictEqual(opts('eeee'), { weekday: 'long' });
    deepStrictEqual(opts('cccc'), { weekday: 'long' });
  });
});

describe('dateOptionsFromSkeleton - hour', () => {
  it('h -> numeric, h12 cycle', () => {
    deepStrictEqual(opts('h'), { hour: 'numeric', hourCycle: 'h12' });
  });

  it('hh -> 2-digit, h12 cycle', () => {
    deepStrictEqual(opts('hh'), { hour: '2-digit', hourCycle: 'h12' });
  });

  it('H -> numeric, h23 cycle', () => {
    deepStrictEqual(opts('H'), { hour: 'numeric', hourCycle: 'h23' });
  });

  it('HH -> 2-digit, h23 cycle', () => {
    deepStrictEqual(opts('HH'), { hour: '2-digit', hourCycle: 'h23' });
  });

  it('k -> numeric, h24 cycle', () => {
    deepStrictEqual(opts('k'), { hour: 'numeric', hourCycle: 'h24' });
  });

  it('K -> numeric, h11 cycle', () => {
    deepStrictEqual(opts('K'), { hour: 'numeric', hourCycle: 'h11' });
  });

  it('j -> numeric without locking the hour cycle', () => {
    deepStrictEqual(opts('j'), { hour: 'numeric' });
  });
});

describe('dateOptionsFromSkeleton - minute and second', () => {
  it('m / mm', () => {
    deepStrictEqual(opts('m'), { minute: 'numeric' });
    deepStrictEqual(opts('mm'), { minute: '2-digit' });
  });

  it('s / ss', () => {
    deepStrictEqual(opts('s'), { second: 'numeric' });
    deepStrictEqual(opts('ss'), { second: '2-digit' });
  });

  it('S -> 1 fractional second digit', () => {
    deepStrictEqual(opts('S'), { fractionalSecondDigits: 1 });
  });

  it('SS -> 2 fractional second digits', () => {
    deepStrictEqual(opts('SS'), { fractionalSecondDigits: 2 });
  });

  it('SSS -> 3 fractional second digits', () => {
    deepStrictEqual(opts('SSS'), { fractionalSecondDigits: 3 });
  });

  it('SSSS clamps to 3 (Intl maximum)', () => {
    deepStrictEqual(opts('SSSS'), { fractionalSecondDigits: 3 });
  });
});

describe('dateOptionsFromSkeleton - AM/PM marker', () => {
  it('a asks for a 12-hour cycle, not a day period', () => {
    deepStrictEqual(opts('a'), { hourCycle: 'h12' });
    deepStrictEqual(opts('aaaa'), { hourCycle: 'h12' });
  });

  it('a does not clobber an explicit 12-hour cycle from the hour field', () => {
    deepStrictEqual(opts('Kmm a'), { hour: 'numeric', minute: '2-digit', hourCycle: 'h11' });
  });

  it('`h a` renders the marker, not a day-period phrase', () => {
    const d = new Date(Date.UTC(2026, 5, 7, 14, 30, 0));
    const expected = new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h12' }).format(
      d,
    );
    const out = formatMessage('{d, time, ::h a}', { d }, 'en-US');
    strictEqual(out, expected);
    strictEqual(/AM|PM/.test(out), true);
    strictEqual(/morning|afternoon|noon|night/.test(out), false);
  });
});

describe('dateOptionsFromSkeleton - day period', () => {
  it('b / B -> descriptive day period', () => {
    deepStrictEqual(opts('B'), { dayPeriod: 'short' });
    deepStrictEqual(opts('BBBB'), { dayPeriod: 'long' });
    deepStrictEqual(opts('bbbbb'), { dayPeriod: 'narrow' });
  });
});

describe('dateOptionsFromSkeleton - time zone', () => {
  it('z / zzzz', () => {
    deepStrictEqual(opts('z'), { timeZoneName: 'short' });
    deepStrictEqual(opts('zzzz'), { timeZoneName: 'long' });
  });

  it('Z / ZZZZ / ZZZZZ', () => {
    deepStrictEqual(opts('Z'), { timeZoneName: 'shortOffset' });
    deepStrictEqual(opts('ZZZZ'), { timeZoneName: 'long' });
    deepStrictEqual(opts('ZZZZZ'), { timeZoneName: 'longOffset' });
  });

  it('O / OOOO', () => {
    deepStrictEqual(opts('O'), { timeZoneName: 'shortOffset' });
    deepStrictEqual(opts('OOOO'), { timeZoneName: 'longOffset' });
  });

  it('v / vvvv -> generic time zone', () => {
    deepStrictEqual(opts('v'), { timeZoneName: 'shortGeneric' });
    deepStrictEqual(opts('vvvv'), { timeZoneName: 'longGeneric' });
  });

  it('X / XX -> ISO offsets', () => {
    deepStrictEqual(opts('X'), { timeZoneName: 'shortOffset' });
    deepStrictEqual(opts('XX'), { timeZoneName: 'longOffset' });
  });
});

describe('dateOptionsFromSkeleton - combinations', () => {
  it('yMMMd produces year + month-short + day', () => {
    deepStrictEqual(opts('yMMMd'), {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  });

  it('HH:mm includes literal punctuation as a no-op', () => {
    deepStrictEqual(opts('HH:mm'), {
      hour: '2-digit',
      hourCycle: 'h23',
      minute: '2-digit',
    });
  });

  it('yyyy-MM-dd combines year, month, day', () => {
    deepStrictEqual(opts('yyyy-MM-dd'), {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  });

  it('EEEE, d MMMM y has weekday + day + month-long + year', () => {
    deepStrictEqual(opts('EEEE, d MMMM y'), {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  });
});

describe('dateOptionsFromSkeleton - quoted spans', () => {
  it("`'literal'` is skipped between symbols", () => {
    deepStrictEqual(opts("y'年'M'月'd'日'"), {
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
    });
  });

  it("`''` is a literal apostrophe and contributes nothing", () => {
    deepStrictEqual(opts("y''M"), { year: 'numeric', month: 'numeric' });
  });

  it('unterminated quote runs to EOF without throwing', () => {
    deepStrictEqual(opts("y'unterminated"), { year: 'numeric' });
  });
});

describe('dateOptionsFromSkeleton - rejected symbols', () => {
  const rejected = ['Q', 'q', 'w', 'W', 'D', 'F', 'g', 'A', 'n', 'N', 'Y'];
  for (const symbol of rejected) {
    it(`${symbol} is rejected with no Intl equivalent`, () => {
      throws(() => opts(symbol), /no Intl\.DateTimeFormat equivalent/);
    });
  }
});

describe('dateOptionsFromSkeleton - edge cases', () => {
  it('empty skeleton -> empty options', () => {
    deepStrictEqual(opts(''), {});
  });

  it('punctuation-only skeleton -> empty options', () => {
    deepStrictEqual(opts('---'), {});
  });

  it('unknown letter throws', () => {
    throws(() => opts('P'), MessageFormatError);
  });

  it('non-letter punctuation between symbols is skipped, not an error', () => {
    deepStrictEqual(opts('Z+'), { timeZoneName: 'shortOffset' });
  });
});

describe('dateOptionsFromSkeleton - end-to-end rendering', () => {
  const dt = new Date(Date.UTC(2026, 5, 7, 14, 30, 0));

  it('yMMMd renders year + short month + day', () => {
    const fmt = new Intl.DateTimeFormat('en-US', opts('yMMMd'));
    const out = fmt.format(dt);
    strictEqual(out.includes('2026'), true);
    strictEqual(out.toLowerCase().includes('jun'), true);
  });

  it('HH:mm:ss renders a 24-hour clock', () => {
    const fmt = new Intl.DateTimeFormat('en-GB', opts('HH:mm:ss'));
    const out = fmt.format(dt);
    strictEqual(/\d{2}:\d{2}:\d{2}/.test(out), true);
  });
});
