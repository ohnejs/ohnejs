import { ok, strictEqual, throws } from 'node:assert';
import { describe, it } from 'node:test';

import { parseDate } from '../../../src/utils/index.ts';

describe('parseDate', () => {
  it('returns valid Date instances unchanged', () => {
    const d = new Date('2024-06-10');
    strictEqual(parseDate(d), d);
  });

  it('parses unix-ms numbers', () => {
    const d = parseDate(1718000000000);
    ok(d instanceof Date);
    strictEqual(d.getTime(), 1718000000000);
  });

  it('parses ISO date strings', () => {
    const d = parseDate('2024-06-10');
    ok(d instanceof Date);
    strictEqual(d.toISOString().slice(0, 10), '2024-06-10');
  });

  it('throws on impossible calendar dates', () => {
    throws(() => parseDate('2024-02-30'), /Expected date/);
  });

  it('throws on Invalid Date', () => {
    throws(() => parseDate(new Date('not-a-date')), /Expected date/);
  });

  it('throws on non-ISO strings', () => {
    throws(() => parseDate('not-a-date'), /Expected date/);
    throws(() => parseDate('1'), /Expected date/);
  });

  it('throws on NaN and Infinity', () => {
    throws(() => parseDate(NaN), /Expected date/);
    throws(() => parseDate(Infinity), /Expected date/);
  });

  it('throws on booleans, null, undefined, objects', () => {
    throws(() => parseDate(true), /Expected date/);
    throws(() => parseDate(null), /Expected date/);
    throws(() => parseDate(undefined), /Expected date/);
    throws(() => parseDate({}), /Expected date/);
  });

  it('throws a descriptive error on bigints', () => {
    throws(() => parseDate(1n), /Expected date/);
  });
});
