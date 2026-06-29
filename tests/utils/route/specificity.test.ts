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
});

describe('compareSpecificity', () => {
  it('orders most-specific-first: static before [param] before [...rest]', () => {
    deepStrictEqual(['/[...all]', '/users/[id]', '/users/new'].sort(compareSpecificity), [
      '/users/new',
      '/users/[id]',
      '/[...all]',
    ]);
  });

  it('prefers the longer pattern on a specificity tie', () => {
    ok(compareSpecificity('/a/b', '/a') < 0);
  });

  it('falls back to a natural compare for equal specificity', () => {
    deepStrictEqual(['/b', '/a', '/c'].sort(compareSpecificity), ['/a', '/b', '/c']);
  });
});
