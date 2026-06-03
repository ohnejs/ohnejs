import { deepStrictEqual, notStrictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { uniqueArray } from '../../../src/utils/index.ts';

describe('uniqueArray', () => {
  it('removes duplicate numbers', () => {
    deepStrictEqual(uniqueArray([1, 2, 2, 3, 1]), [1, 2, 3]);
  });

  it('removes duplicate strings', () => {
    deepStrictEqual(uniqueArray(['a', 'b', 'a']), ['a', 'b']);
  });

  it('preserves order of first occurrence', () => {
    deepStrictEqual(uniqueArray([3, 1, 2, 1, 3]), [3, 1, 2]);
  });

  it('returns an empty array unchanged', () => {
    deepStrictEqual(uniqueArray([]), []);
  });

  it('keeps distinct object references', () => {
    const a = { x: 1 };
    const b = { x: 1 };
    deepStrictEqual(uniqueArray([a, b, a]), [a, b]);
  });

  it('returns a new array (no mutation)', () => {
    const input = [1, 2, 3];
    const output = uniqueArray(input);
    notStrictEqual(output, input);
    deepStrictEqual(input, [1, 2, 3]);
  });
});
