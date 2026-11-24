import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { editDistance } from '../../../src/utils/index.ts';

describe('editDistance', () => {
  it('counts insertions, deletions, and substitutions between strings', () => {
    strictEqual(editDistance('kitten', 'sitting'), 3);
    strictEqual(editDistance('sitting', 'kitten'), 3);
    strictEqual(editDistance('flaw', 'lawn'), 2);
  });

  it('measures token arrays by token', () => {
    strictEqual(
      editDistance(['guten', 'tag', 'herr', 'huber'], ['guten', 'morgen', 'herr', 'huber']),
      1,
    );
    strictEqual(editDistance(['a', 'b', 'c'], ['c']), 2);
  });

  it('is the other length against an empty input, and `0` for equal inputs', () => {
    strictEqual(editDistance('', 'abc'), 3);
    strictEqual(editDistance('abc', ''), 3);
    strictEqual(editDistance('same', 'same'), 0);
    strictEqual(editDistance([], []), 0);
  });
});
