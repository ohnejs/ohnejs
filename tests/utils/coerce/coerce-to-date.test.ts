import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { coerceToDate } from '../../../src/utils/index.ts';

describe('coerceToDate', () => {
  it('returns Date instances unchanged', () => {
    const d = new Date(0);
    strictEqual(coerceToDate(d), d);
  });

  it('returns Invalid Date unchanged', () => {
    const invalid = new Date('not a date');
    strictEqual(coerceToDate(invalid), invalid);
  });

  it('coerces finite numbers as unix-ms', () => {
    const result = coerceToDate(0);
    strictEqual(result instanceof Date, true);
    strictEqual((result as Date).getTime(), 0);
  });

  it('coerces parseable strings', () => {
    const result = coerceToDate('2024-06-10T00:00:00.000Z');
    strictEqual(result instanceof Date, true);
    strictEqual((result as Date).toISOString(), '2024-06-10T00:00:00.000Z');
  });

  it('returns unparseable strings unchanged', () => {
    strictEqual(coerceToDate('not a date'), 'not a date');
    strictEqual(coerceToDate(''), '');
  });

  it('returns NaN and Infinity unchanged', () => {
    const nanResult = coerceToDate(NaN);
    strictEqual(Number.isNaN(nanResult), true);
    strictEqual(coerceToDate(Infinity), Infinity);
    strictEqual(coerceToDate(-Infinity), -Infinity);
  });

  it('returns null, undefined, booleans, objects unchanged', () => {
    strictEqual(coerceToDate(null), null);
    strictEqual(coerceToDate(undefined), undefined);
    strictEqual(coerceToDate(true), true);
    strictEqual(coerceToDate(false), false);
    const obj = { a: 1 };
    strictEqual(coerceToDate(obj), obj);
  });

  it('returns short digit-shaped strings unchanged', () => {
    strictEqual(coerceToDate('1'), '1');
    strictEqual(coerceToDate('12345'), '12345');
    strictEqual(coerceToDate('2024'), '2024');
  });

  it('returns impossible calendar dates unchanged', () => {
    strictEqual(coerceToDate('2024-02-30'), '2024-02-30');
    strictEqual(coerceToDate('2024-13-01'), '2024-13-01');
  });

  it('returns whitespace-only strings unchanged', () => {
    strictEqual(coerceToDate('   '), '   ');
  });

  it('coerces date-only and date+time ISO strings', () => {
    const dateOnly = coerceToDate('2024-06-10');
    strictEqual(dateOnly instanceof Date, true);
    strictEqual((dateOnly as Date).toISOString().slice(0, 10), '2024-06-10');

    const withTime = coerceToDate('2024-06-10T14:30:00Z');
    strictEqual(withTime instanceof Date, true);
    strictEqual((withTime as Date).toISOString(), '2024-06-10T14:30:00.000Z');
  });
});
