import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { getOrSet } from '../../../src/utils/index.ts';

describe('getOrSet', () => {
  it('creates and stores the value on the first read', () => {
    const map = new Map<string, number[]>();
    const value = getOrSet(map, 'a', () => [1]);
    deepStrictEqual(value, [1]);
    strictEqual(map.get('a'), value);
  });

  it('returns the stored value without calling create again', () => {
    const map = new Map<string, object>();
    let calls = 0;
    const first = getOrSet(map, 'k', () => {
      calls += 1;
      return {};
    });
    const second = getOrSet(map, 'k', () => {
      calls += 1;
      return {};
    });
    strictEqual(second, first);
    strictEqual(calls, 1);
  });

  it('keeps keys apart', () => {
    const map = new Map<number, string>();
    strictEqual(
      getOrSet(map, 1, () => 'one'),
      'one',
    );
    strictEqual(
      getOrSet(map, 2, () => 'two'),
      'two',
    );
    strictEqual(map.size, 2);
  });
});
