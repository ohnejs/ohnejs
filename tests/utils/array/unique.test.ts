import { deepStrictEqual, notStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { unique } from '../../../src/utils/index.ts';

describe('unique', () => {
  it('removes duplicate numbers', () => {
    deepStrictEqual(unique([1, 2, 2, 3, 1]), [1, 2, 3]);
  });

  it('removes duplicate strings', () => {
    deepStrictEqual(unique(['a', 'b', 'a']), ['a', 'b']);
  });

  it('preserves order of first occurrence', () => {
    deepStrictEqual(unique([3, 1, 2, 1, 3]), [3, 1, 2]);
  });

  it('returns an empty array unchanged', () => {
    deepStrictEqual(unique([]), []);
  });

  it('keeps the original references in the output', () => {
    const a = { x: 1 };
    const b = { x: 1 };
    const out = unique([a, b, a]);
    strictEqual(out.length, 2);
    strictEqual(out[0], a);
    strictEqual(out[1], b);
  });

  it('dedups `NaN`', () => {
    deepStrictEqual(unique([NaN, 1, NaN, 2]), [NaN, 1, 2]);
  });

  it('returns a new array (no mutation)', () => {
    const input = [1, 2, 3];
    const output = unique(input);
    notStrictEqual(output, input);
    deepStrictEqual(input, [1, 2, 3]);
  });
});
