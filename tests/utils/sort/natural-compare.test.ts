import { deepStrictEqual, ok } from 'node:assert';
import { describe, it } from 'node:test';

import { naturalCompare } from '../../../src/utils/index.ts';

describe('naturalCompare', () => {
  it('orders digit runs by numeric value, not lexically', () => {
    deepStrictEqual(['item-11', 'item-2', 'item-1'].sort(naturalCompare), [
      'item-1',
      'item-2',
      'item-11',
    ]);
  });

  it('sorts plain strings alphabetically', () => {
    deepStrictEqual(['b', 'c', 'a'].sort(naturalCompare), ['a', 'b', 'c']);
  });

  it('returns a negative, zero, or positive number', () => {
    ok(naturalCompare('a', 'b') < 0);
    ok(naturalCompare('b', 'a') > 0);
    deepStrictEqual(naturalCompare('a', 'a'), 0);
  });
});
