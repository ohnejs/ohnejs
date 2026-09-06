import { strictEqual, throws } from 'node:assert';
import { describe, it } from 'node:test';

import { formatDatePattern } from '../../../src/utils/i18n/format-date-pattern.ts';

const BERLIN = 'Europe/Berlin';
const NEW_YORK = 'America/New_York';

const EN = { language: 'en', timeZone: BERLIN };
const DE = { language: 'de', timeZone: BERLIN };
const UTC = { language: 'en', timeZone: 'UTC' };

// Monday 2025-02-24 21:30:25.007 in Berlin.
const INSTANT = Date.UTC(2025, 1, 24, 20, 30, 25, 7);

const EN_TOKENS: Record<string, string> = {
  YYYY: '2025',
  YY: '25',
  M: '2',
  MM: '02',
  MMM: 'Feb',
  MMMM: 'February',
  D: '24',
  DD: '24',
  Do: '24th',
  d: '1',
  dd: 'Mo',
  ddd: 'Mon',
  dddd: 'Monday',
  Q: '1',
  w: '9',
  ww: '09',
  wo: '9th',
  W: '9',
  WW: '09',
  H: '21',
  HH: '21',
  h: '9',
  hh: '09',
  k: '21',
  kk: '21',
  m: '30',
  mm: '30',
  s: '25',
  ss: '25',
  SSS: '007',
  A: 'PM',
  a: 'pm',
  Z: '+01:00',
  ZZ: '+0100',
  z: 'GMT+1',
  zzz: 'Central European Standard Time',
  L: '02/24/2025',
  l: '2/24/2025',
  LL: 'February 24, 2025',
  ll: 'Feb 24, 2025',
  LT: '9:30 PM',
  LTS: '9:30:25 PM',
};

const DE_TOKENS: Record<string, string> = {
  YYYY: '2025',
  YY: '25',
  M: '2',
  MM: '02',
  MMM: 'Feb',
  MMMM: 'Februar',
  D: '24',
  DD: '24',
  Do: '24.',
  d: '1',
  dd: 'Mo',
  ddd: 'Mo',
  dddd: 'Montag',
  Q: '1',
  w: '9',
  ww: '09',
  wo: '9.',
  W: '9',
  WW: '09',
  H: '21',
  HH: '21',
  h: '9',
  hh: '09',
  k: '21',
  kk: '21',
  m: '30',
  mm: '30',
  s: '25',
  ss: '25',
  SSS: '007',
  A: 'PM',
  a: 'pm',
  Z: '+01:00',
  ZZ: '+0100',
  z: 'MEZ',
  zzz: 'Mitteleuropäische Normalzeit',
  L: '24.02.2025',
  l: '24.2.2025',
  LL: '24. Februar 2025',
  ll: '24. Feb. 2025',
  LT: '21:30',
  LTS: '21:30:25',
};

describe('formatDatePattern - tokens in en', () => {
  for (const [token, expected] of Object.entries(EN_TOKENS)) {
    it(`${token} -> ${expected}`, () => {
      strictEqual(formatDatePattern(INSTANT, token, EN), expected);
    });
  }
});

describe('formatDatePattern - tokens in de', () => {
  for (const [token, expected] of Object.entries(DE_TOKENS)) {
    it(`${token} -> ${expected}`, () => {
      strictEqual(formatDatePattern(INSTANT, token, DE), expected);
    });
  }
});

describe('formatDatePattern - composition', () => {
  it('joins tokens with the literal characters between them', () => {
    strictEqual(
      formatDatePattern(INSTANT, 'YYYY-MM-DD HH:mm:ss.SSS Z', EN),
      '2025-02-24 21:30:25.007 +01:00',
    );
    strictEqual(formatDatePattern(INSTANT, 'dddd, D. MMMM YYYY', DE), 'Montag, 24. Februar 2025');
  });

  it('matches the longest token first', () => {
    strictEqual(formatDatePattern(INSTANT, 'MMMMM', EN), 'February2');
    strictEqual(formatDatePattern(INSTANT, 'DDD', EN), '2424');
    strictEqual(formatDatePattern(INSTANT, 'LTS', EN), '9:30:25 PM');
  });

  it('passes unknown letters through', () => {
    strictEqual(formatDatePattern(INSTANT, 'YYYY-MM-DDTHH:mm:ss', EN), '2025-02-24T21:30:25');
    strictEqual(formatDatePattern(INSTANT, 'x X E', EN), 'x X E');
  });

  it('formats an empty pattern as an empty string', () => {
    strictEqual(formatDatePattern(INSTANT, '', EN), '');
  });
});

describe('formatDatePattern - escapes', () => {
  it('renders a bracketed span verbatim', () => {
    strictEqual(formatDatePattern(INSTANT, '[Today is] dddd', EN), 'Today is Monday');
    strictEqual(formatDatePattern(INSTANT, 'YYYY [YYYY]', EN), '2025 YYYY');
  });

  it('renders an empty escape as nothing', () => {
    strictEqual(formatDatePattern(INSTANT, 'D[]D', EN), '2424');
  });

  it('keeps an unterminated bracket as a literal', () => {
    strictEqual(formatDatePattern(INSTANT, '[D', EN), '[24');
    strictEqual(formatDatePattern(INSTANT, 'D]', EN), '24]');
  });
});

describe('formatDatePattern - presets', () => {
  it('protects a preset from the token pass', () => {
    strictEqual(formatDatePattern(INSTANT, 'L LT', EN), '02/24/2025 9:30 PM');
    strictEqual(formatDatePattern(INSTANT, 'LL [um] LTS', DE), '24. Februar 2025 um 21:30:25');
  });

  it('escapes a preset letter like any other token', () => {
    strictEqual(formatDatePattern(INSTANT, '[L] L', EN), 'L 02/24/2025');
  });
});

describe('formatDatePattern - hours', () => {
  const midnight = Date.UTC(2025, 1, 24, 0, 0, 0);

  it('k and kk render midnight as 24', () => {
    strictEqual(formatDatePattern(midnight, 'k', UTC), '24');
    strictEqual(formatDatePattern(midnight, 'kk', UTC), '24');
    strictEqual(formatDatePattern(INSTANT, 'k', UTC), '20');
  });

  it('H and h render midnight as 0 and 12', () => {
    strictEqual(formatDatePattern(midnight, 'H', UTC), '0');
    strictEqual(formatDatePattern(midnight, 'HH', UTC), '00');
    strictEqual(formatDatePattern(midnight, 'h', UTC), '12');
    strictEqual(formatDatePattern(midnight, 'hh A', UTC), '12 AM');
  });

  it('h renders noon as 12', () => {
    strictEqual(formatDatePattern(Date.UTC(2025, 1, 24, 12), 'h A', UTC), '12 PM');
  });
});

describe('formatDatePattern - ordinals', () => {
  const day = (date: number) => Date.UTC(2025, 0, date, 12);

  it('suffixes the day in en', () => {
    strictEqual(formatDatePattern(day(1), 'Do', UTC), '1st');
    strictEqual(formatDatePattern(day(2), 'Do', UTC), '2nd');
    strictEqual(formatDatePattern(day(3), 'Do', UTC), '3rd');
    strictEqual(formatDatePattern(day(4), 'Do', UTC), '4th');
    strictEqual(formatDatePattern(day(11), 'Do', UTC), '11th');
    strictEqual(formatDatePattern(day(21), 'Do', UTC), '21st');
    strictEqual(formatDatePattern(day(22), 'Do', UTC), '22nd');
    strictEqual(formatDatePattern(day(23), 'Do', UTC), '23rd');
  });

  it('suffixes the day in every en region', () => {
    strictEqual(formatDatePattern(day(1), 'Do', { language: 'en-GB', timeZone: 'UTC' }), '1st');
    strictEqual(formatDatePattern(day(2), 'Do', { language: 'EN-us', timeZone: 'UTC' }), '2nd');
  });

  it('appends a period outside en', () => {
    strictEqual(formatDatePattern(day(1), 'Do', { language: 'de', timeZone: 'UTC' }), '1.');
    strictEqual(formatDatePattern(day(2), 'Do', { language: 'bs', timeZone: 'UTC' }), '2.');
  });
});

describe('formatDatePattern - weeks', () => {
  const utc = (year: number, month: number, day: number) => Date.UTC(year, month - 1, day, 12);

  it('W counts ISO weeks across a year boundary', () => {
    strictEqual(formatDatePattern(utc(2020, 12, 31), 'W', UTC), '53');
    strictEqual(formatDatePattern(utc(2021, 1, 1), 'W', UTC), '53');
    strictEqual(formatDatePattern(utc(2021, 1, 3), 'WW', UTC), '53');
    strictEqual(formatDatePattern(utc(2021, 1, 4), 'W', UTC), '1');
    strictEqual(formatDatePattern(utc(2024, 12, 30), 'WW', UTC), '01');
    strictEqual(formatDatePattern(utc(2018, 12, 31), 'W', UTC), '1');
  });

  it('w starts the en week on Sunday and opens week 1 with January 1', () => {
    strictEqual(formatDatePattern(utc(2020, 12, 26), 'w', UTC), '52');
    strictEqual(formatDatePattern(utc(2020, 12, 27), 'w', UTC), '1');
    strictEqual(formatDatePattern(utc(2021, 1, 1), 'w', UTC), '1');
    strictEqual(formatDatePattern(utc(2021, 1, 2), 'ww', UTC), '01');
    strictEqual(formatDatePattern(utc(2021, 1, 3), 'wo', UTC), '2nd');
  });

  it('w starts the de week on Monday and needs four days for week 1', () => {
    const de = { language: 'de', timeZone: 'UTC' };
    strictEqual(formatDatePattern(utc(2021, 1, 1), 'w', de), '53');
    strictEqual(formatDatePattern(utc(2021, 1, 3), 'ww', de), '53');
    strictEqual(formatDatePattern(utc(2021, 1, 3), 'wo', de), '53.');
    strictEqual(formatDatePattern(utc(2021, 1, 4), 'w', de), '1');
    strictEqual(formatDatePattern(utc(2024, 12, 30), 'w', de), '1');
  });

  it('reads the week from the wall clock of the zone', () => {
    const sunday = Date.UTC(2025, 2, 2, 23, 30);
    strictEqual(formatDatePattern(sunday, 'W d', UTC), '9 0');
    strictEqual(formatDatePattern(sunday, 'W d', EN), '10 1');
  });
});

describe('formatDatePattern - offsets and zones', () => {
  const beforeDST = Date.UTC(2025, 2, 9, 6, 59, 59);
  const afterDST = Date.UTC(2025, 2, 9, 7, 0, 0);
  const newYork = { language: 'en', timeZone: NEW_YORK };

  it('Z and ZZ follow the zone across a DST edge', () => {
    strictEqual(formatDatePattern(beforeDST, 'HH:mm:ss Z ZZ', newYork), '01:59:59 -05:00 -0500');
    strictEqual(formatDatePattern(afterDST, 'HH:mm:ss Z ZZ', newYork), '03:00:00 -04:00 -0400');
  });

  it('z and zzz name the zone across a DST edge', () => {
    strictEqual(formatDatePattern(beforeDST, 'z', newYork), 'EST');
    strictEqual(formatDatePattern(afterDST, 'z', newYork), 'EDT');
    strictEqual(formatDatePattern(beforeDST, 'zzz', newYork), 'Eastern Standard Time');
    strictEqual(formatDatePattern(afterDST, 'zzz', newYork), 'Eastern Daylight Time');
  });

  it('names the zone in the language', () => {
    strictEqual(
      formatDatePattern(INSTANT, 'zzz', { language: 'de', timeZone: NEW_YORK }),
      'Nordamerikanische Ostküsten-Normalzeit',
    );
  });

  it('renders a half-hour offset', () => {
    strictEqual(
      formatDatePattern(INSTANT, 'Z', { language: 'en', timeZone: 'Asia/Kolkata' }),
      '+05:30',
    );
  });
});

describe('formatDatePattern - UTC', () => {
  it('reads the day in UTC', () => {
    const lateEvening = Date.UTC(2025, 1, 24, 23, 30);
    strictEqual(formatDatePattern(lateEvening, 'YYYY-MM-DD HH:mm', UTC), '2025-02-24 23:30');
    strictEqual(formatDatePattern(lateEvening, 'YYYY-MM-DD HH:mm', EN), '2025-02-25 00:30');
  });

  it('renders a zero offset', () => {
    strictEqual(formatDatePattern(INSTANT, 'Z ZZ z', UTC), '+00:00 +0000 UTC');
  });
});

describe('formatDatePattern - options', () => {
  it('reads the environment zone when timeZone is omitted', () => {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    strictEqual(
      formatDatePattern(INSTANT, 'YYYY-MM-DD HH:mm Z', { language: 'en' }),
      formatDatePattern(INSTANT, 'YYYY-MM-DD HH:mm Z', { language: 'en', timeZone }),
    );
  });

  it('throws a RangeError for an unknown zone', () => {
    throws(
      () => formatDatePattern(INSTANT, 'YYYY', { language: 'en', timeZone: 'Nope/Zone' }),
      RangeError,
    );
  });
});

describe('formatDatePattern - pattern cache', () => {
  it('returns the same output on repeat', () => {
    const pattern = 'dddd, MMMM Do YYYY [at] h:mm A z';
    const first = formatDatePattern(INSTANT, pattern, EN);
    strictEqual(first, 'Monday, February 24th 2025 at 9:30 PM GMT+1');
    strictEqual(formatDatePattern(INSTANT, pattern, EN), first);
    strictEqual(formatDatePattern(INSTANT, pattern, DE), 'Montag, Februar 24. 2025 at 9:30 PM MEZ');
    strictEqual(formatDatePattern(INSTANT, pattern, EN), first);
  });

  it('keeps a cached pattern bound to the instant, not the first call', () => {
    const pattern = 'YYYY-MM-DD';
    strictEqual(formatDatePattern(INSTANT, pattern, UTC), '2025-02-24');
    strictEqual(formatDatePattern(Date.UTC(2024, 6, 4), pattern, UTC), '2024-07-04');
  });
});
