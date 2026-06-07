import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { isBoolean } from '../../../src/utils/index.ts';

describe('isBoolean', () => {
  it('returns true for booleans', () => {
    strictEqual(isBoolean(true), true);
    strictEqual(isBoolean(false), true);
  });

  it('returns false for non-booleans', () => {
    strictEqual(isBoolean(0), false);
    strictEqual(isBoolean(1), false);
    strictEqual(isBoolean('true'), false);
    strictEqual(isBoolean(null), false);
  });
});
