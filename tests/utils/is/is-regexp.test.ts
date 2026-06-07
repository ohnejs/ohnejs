import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { isRegExp } from '../../../src/utils/index.ts';

describe('isRegExp', () => {
  it('returns true for RegExp instances', () => {
    strictEqual(isRegExp(/x/), true);
    strictEqual(isRegExp(new RegExp('x')), true);
  });

  it('returns false for non-RegExp values', () => {
    strictEqual(isRegExp('x'), false);
    strictEqual(isRegExp(null), false);
    strictEqual(isRegExp({}), false);
  });
});
