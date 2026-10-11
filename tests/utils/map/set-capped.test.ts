import { deepStrictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { setCapped } from '../../../src/utils/index.ts';

describe('setCapped', () => {
  it('moves a set key to the newest end', () => {
    const map = new Map([
      ['a', 1],
      ['b', 2],
    ]);
    deepStrictEqual(
      [...setCapped(map, 'a', 1, 2)],
      [
        ['b', 2],
        ['a', 1],
      ],
    );
  });

  it('drops the oldest entries past the limit', () => {
    const map = new Map([
      ['a', 1],
      ['b', 2],
    ]);
    deepStrictEqual(
      [...setCapped(map, 'c', 3, 2)],
      [
        ['b', 2],
        ['c', 3],
      ],
    );
  });

  it('keeps every entry within the limit', () => {
    deepStrictEqual([...setCapped(new Map<string, number>(), 'a', 1, 3)], [['a', 1]]);
  });
});
