import { deepStrictEqual, throws } from 'node:assert';
import { describe, it } from 'node:test';

import { chunk } from '../../../src/utils/array/chunk.ts';

describe('chunk', () => {
  it('splits into consecutive slices, the last one holding the remainder', () => {
    deepStrictEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
    deepStrictEqual(chunk([1, 2, 3, 4], 2), [
      [1, 2],
      [3, 4],
    ]);
  });

  it('keeps a short array whole and an empty one empty', () => {
    deepStrictEqual(chunk([1, 2], 3), [[1, 2]]);
    deepStrictEqual(chunk([], 3), []);
  });

  it('rejects a size below one', () => {
    throws(() => chunk([1], 0), /Invalid chunk size: 0/);
    throws(() => chunk([1], -2), /Invalid chunk size: -2/);
  });
});
