import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { fuzzyMatch } from '../../../src/utils/index.ts';

describe('fuzzyMatch', () => {
  it('matches a subsequence that is not a prefix', () => {
    deepStrictEqual(fuzzyMatch('te3', 'test-3'), { score: 72, positions: [0, 1, 5] });
  });

  it('returns null when the needle is not a subsequence', () => {
    strictEqual(fuzzyMatch('xyz', 'test-3'), null);
  });

  it('returns null when the needle is longer than the haystack', () => {
    strictEqual(fuzzyMatch('testing', 'test'), null);
  });

  it('matches an empty needle against anything with no positions', () => {
    deepStrictEqual(fuzzyMatch('', 'test-3'), { score: 0, positions: [] });
  });

  it('is case-insensitive', () => {
    const match = fuzzyMatch('TS', 'tools.ts');
    deepStrictEqual(match?.positions, [6, 7]);
  });

  it('prefers a run after a separator over an earlier scattered match', () => {
    deepStrictEqual(fuzzyMatch('ts', 'tools.ts')?.positions, [6, 7]);
  });

  it('prefers a consecutive run over a scattered one', () => {
    deepStrictEqual(fuzzyMatch('oo', 'fooxoo')?.positions, [1, 2]);
  });

  it('matches at a camelCase hump', () => {
    deepStrictEqual(fuzzyMatch('gf', 'getFile')?.positions, [0, 3]);
  });

  it('treats a digit after a letter as a word boundary', () => {
    strictEqual(fuzzyMatch('2', 'ab2')?.score, fuzzyMatch('2', 'a-2')?.score);
    strictEqual(fuzzyMatch('2', 'AB2')?.score, fuzzyMatch('2', 'A-2')?.score);
  });

  it('does not treat a digit after a digit as a word boundary', () => {
    strictEqual(fuzzyMatch('2', 'a12')?.score, fuzzyMatch('c', 'abc')?.score);
  });

  it('does not treat a caseless letter after a letter as a word boundary', () => {
    strictEqual(fuzzyMatch('う', 'あいう')?.score, fuzzyMatch('c', 'abc')?.score);
  });

  it('does not treat a separator as the start of a word', () => {
    strictEqual(fuzzyMatch('.', 'readme.md')?.score, fuzzyMatch('.', 'README.md')?.score);
  });

  it('scores an exact-case hit above a case-folded one', () => {
    const exact = fuzzyMatch('F', 'File');
    const folded = fuzzyMatch('f', 'File');
    strictEqual((exact?.score ?? 0) > (folded?.score ?? 0), true);
  });

  it('ranks a prefix match above a tail match', () => {
    const prefix = fuzzyMatch('te', 'test')?.score ?? 0;
    const tail = fuzzyMatch('te', 'latte')?.score ?? 0;
    strictEqual(prefix > tail, true);
  });

  it('matches the full string', () => {
    deepStrictEqual(fuzzyMatch('test', 'test'), { score: 100, positions: [0, 1, 2, 3] });
  });
});
