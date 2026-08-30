import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { isISODate } from '../../../src/utils/index.ts';

describe('isISODate', () => {
  it('returns true for real calendar days', () => {
    strictEqual(isISODate('2024-01-01'), true);
    strictEqual(isISODate('1999-12-31'), true);
    strictEqual(isISODate('2024-06-15'), true);
  });

  it('returns true for leap days in leap years', () => {
    strictEqual(isISODate('2024-02-29'), true);
    strictEqual(isISODate('2000-02-29'), true);
  });

  it('returns false for leap days in common years', () => {
    strictEqual(isISODate('2023-02-29'), false);
    strictEqual(isISODate('1900-02-29'), false);
  });

  it('returns false for overflowing months and days', () => {
    strictEqual(isISODate('2024-13-01'), false);
    strictEqual(isISODate('2024-00-10'), false);
    strictEqual(isISODate('2024-04-31'), false);
    strictEqual(isISODate('2024-01-00'), false);
    strictEqual(isISODate('2024-01-32'), false);
  });

  it('returns false for the wrong width', () => {
    strictEqual(isISODate('2024-1-1'), false);
    strictEqual(isISODate('24-01-01'), false);
    strictEqual(isISODate('2024-011-01'), false);
    strictEqual(isISODate('2024-01-011'), false);
  });

  it('returns false for non-date strings and non-strings', () => {
    strictEqual(isISODate('2024/01/01'), false);
    strictEqual(isISODate(''), false);
    strictEqual(isISODate(20240101), false);
    strictEqual(isISODate(new Date()), false);
    strictEqual(isISODate(null), false);
    strictEqual(isISODate(undefined), false);
  });
});
