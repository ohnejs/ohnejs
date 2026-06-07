import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { isSet } from '../../../src/utils/index.ts';

describe('isSet', () => {
  it('returns true for Set instances', () => {
    strictEqual(isSet(new Set()), true);
    strictEqual(isSet(new Set([1, 2])), true);
  });

  it('returns false for non-Set values', () => {
    strictEqual(isSet(new Map()), false);
    strictEqual(isSet({}), false);
    strictEqual(isSet([]), false);
    strictEqual(isSet(null), false);
    strictEqual(isSet(undefined), false);
  });
});
