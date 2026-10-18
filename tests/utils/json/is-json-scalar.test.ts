import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { isJSONScalar } from '../../../src/utils/index.ts';

describe('isJSONScalar', () => {
  it('returns true for JSON leaves', () => {
    strictEqual(isJSONScalar(null), true);
    strictEqual(isJSONScalar(''), true);
    strictEqual(isJSONScalar('Thrall'), true);
    strictEqual(isJSONScalar(false), true);
    strictEqual(isJSONScalar(0), true);
    strictEqual(isJSONScalar(-1.5), true);
  });

  it('returns false for numbers JSON cannot keep', () => {
    strictEqual(isJSONScalar(NaN), false);
    strictEqual(isJSONScalar(Infinity), false);
  });

  it('returns false for containers and values JSON drops', () => {
    strictEqual(isJSONScalar([]), false);
    strictEqual(isJSONScalar({}), false);
    strictEqual(isJSONScalar(undefined), false);
    strictEqual(isJSONScalar(10n), false);
  });
});
