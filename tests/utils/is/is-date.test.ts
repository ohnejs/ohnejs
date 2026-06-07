import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { isDate } from '../../../src/utils/index.ts';

describe('isDate', () => {
  it('returns true for valid Date instances', () => {
    strictEqual(isDate(new Date()), true);
    strictEqual(isDate(new Date(0)), true);
  });

  it('returns false for Invalid Date', () => {
    strictEqual(isDate(new Date('not a date')), false);
  });

  it('returns false for non-Date values', () => {
    strictEqual(isDate('2024-01-01'), false);
    strictEqual(isDate(0), false);
    strictEqual(isDate(null), false);
  });
});
