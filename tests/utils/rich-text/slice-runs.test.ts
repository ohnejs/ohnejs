import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { RichTextRun } from '../../../src/utils/index.ts';

import { sliceRuns } from '../../../src/utils/index.ts';

const runs: RichTextRun[] = [
  { text: 'ab' },
  { text: 'cd', marks: ['em'] },
  { text: 'ef', link: { url: '/e' } },
];

describe('sliceRuns', () => {
  it('returns [] for no runs', () => {
    deepStrictEqual(sliceRuns([], 0), []);
  });

  it('cuts the runs at both ends', () => {
    deepStrictEqual(sliceRuns(runs, 1, 5), [
      { text: 'b' },
      { text: 'cd', marks: ['em'] },
      { text: 'e', link: { url: '/e' } },
    ]);
  });

  it('cuts inside one run', () => {
    deepStrictEqual(sliceRuns([{ text: 'abc', marks: ['strong'] }], 1, 2), [
      { text: 'b', marks: ['strong'] },
    ]);
  });

  it('runs to the end without an end offset', () => {
    deepStrictEqual(sliceRuns(runs, 3), [
      { text: 'd', marks: ['em'] },
      { text: 'ef', link: { url: '/e' } },
    ]);
  });

  it('drops runs outside the range', () => {
    deepStrictEqual(sliceRuns(runs, 2, 4), [{ text: 'cd', marks: ['em'] }]);
  });

  it('returns [] for an empty range', () => {
    deepStrictEqual(sliceRuns(runs, 3, 3), []);
  });

  it('drops runs with empty text', () => {
    deepStrictEqual(sliceRuns([{ text: 'a' }, { text: '' }, { text: 'b' }], 0), [
      { text: 'a' },
      { text: 'b' },
    ]);
  });

  it('clamps offsets past either end', () => {
    deepStrictEqual(sliceRuns(runs, -2, 99), runs);
  });

  it('keeps a whole run as it is, and copies a cut one', () => {
    const sliced = sliceRuns(runs, 1);
    strictEqual(sliced[1], runs[1]);
    strictEqual(sliced[0] === runs[0], false);
    deepStrictEqual(runs[0], { text: 'ab' });
  });

  it('returns a new list when it cuts nothing', () => {
    const sliced = sliceRuns(runs, 0);
    deepStrictEqual(sliced, runs);
    strictEqual(sliced === runs, false);
  });
});
