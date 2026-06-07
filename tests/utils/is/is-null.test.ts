import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { isNull } from '../../../src/utils/index.ts';

describe('isNull', () => {
  it('returns true for null', () => {
    strictEqual(isNull(null), true);
  });

  it('returns false for undefined and other values', () => {
    strictEqual(isNull(undefined), false);
    strictEqual(isNull(0), false);
    strictEqual(isNull(''), false);
  });
});
