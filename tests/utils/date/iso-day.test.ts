import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { isoDayToMs, msToISODay } from '../../../src/utils/index.ts';

describe('isoDayToMs', () => {
  it('reads a real day as its UTC midnight, years 00-99 literal', () => {
    strictEqual(isoDayToMs('1970-01-02'), 86_400_000);
    strictEqual(isoDayToMs('2024-02-29'), Date.UTC(2024, 1, 29));
    strictEqual(new Date(isoDayToMs('0050-01-01')!).getUTCFullYear(), 50);
  });

  it('gives `undefined` for a day that does not exist or is malformed', () => {
    for (const value of ['2023-02-29', '2024-13-01', '2024-1-1', '']) {
      strictEqual(isoDayToMs(value), undefined, value);
    }
  });
});

describe('msToISODay', () => {
  it('writes the UTC day, the year padded', () => {
    strictEqual(msToISODay(86_400_000), '1970-01-02');
    strictEqual(msToISODay(isoDayToMs('0050-01-01')!), '0050-01-01');
  });

  it('round-trips through `isoDayToMs`', () => {
    for (const day of ['2024-02-29', '1999-12-31', '0001-01-01']) {
      strictEqual(msToISODay(isoDayToMs(day)!), day);
    }
  });
});
