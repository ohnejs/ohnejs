import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { isString } from '../../../src/utils/index.ts';

describe('isString', () => {
  it('returns true for strings', () => {
    strictEqual(isString('hi'), true);
    strictEqual(isString(''), true);
  });

  it('returns false for non-strings', () => {
    strictEqual(isString(1), false);
    strictEqual(isString(null), false);
    strictEqual(isString(undefined), false);
    strictEqual(isString(['a']), false);
    strictEqual(isString({}), false);
  });
});
