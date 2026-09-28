import { deepStrictEqual, ok } from 'node:assert';
import { describe, it } from 'node:test';

import { compareSpecificity, specificity } from '../../../src/utils/index.ts';

describe('specificity', () => {
  it('scores static 2, [param] 1, and [...rest] 0 per segment', () => {
    deepStrictEqual(specificity('/users/new'), [2, 2]);
    deepStrictEqual(specificity('/users/[id]'), [2, 1]);
    deepStrictEqual(specificity('/[...path]'), [0]);
    deepStrictEqual(specificity('/'), []);
  });

  it('scores a segment mixing text with a param half a step above the bare param', () => {
    deepStrictEqual(specificity('/posts/[id].json'), [2, 1.5]);
    deepStrictEqual(specificity('/v:version'), [1.5]);
    deepStrictEqual(specificity('/files-[...path]'), [0.5]);
  });
});

describe('compareSpecificity', () => {
  it('orders most-specific-first: static before [param] before [...rest]', () => {
    deepStrictEqual(['/[...all]', '/users/[id]', '/users/new'].sort(compareSpecificity), [
      '/users/new',
      '/users/[id]',
      '/[...all]',
    ]);
  });

  it('ranks a static segment before one mixing text with a param, before the bare param', () => {
    deepStrictEqual(
      ['/posts/[id]', '/posts/report-[id]', '/posts/report-final'].sort(compareSpecificity),
      ['/posts/report-final', '/posts/report-[id]', '/posts/[id]'],
    );
  });

  it('prefers the longer pattern on a specificity tie', () => {
    ok(compareSpecificity('/a/b', '/a') < 0);
  });

  it('falls back to a natural compare for equal specificity', () => {
    deepStrictEqual(['/b', '/a', '/c'].sort(compareSpecificity), ['/a', '/b', '/c']);
  });
});
