import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { isMap } from '../../../src/utils/index.ts';

describe('isMap', () => {
  it('returns true for Map instances', () => {
    strictEqual(isMap(new Map()), true);
    strictEqual(isMap(new Map([['a', 1]])), true);
  });

  it('returns false for non-Map values', () => {
    strictEqual(isMap(new Set()), false);
    strictEqual(isMap({}), false);
    strictEqual(isMap([]), false);
    strictEqual(isMap(null), false);
    strictEqual(isMap(undefined), false);
  });
});
