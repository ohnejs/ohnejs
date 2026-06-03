import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { first } from '../../../src/utils/index.ts';

describe('first', () => {
  it('returns the first element', () => {
    strictEqual(first([1, 2, 3]), 1);
  });

  it('returns the only element', () => {
    strictEqual(first(['a']), 'a');
  });

  it('returns undefined for an empty array', () => {
    strictEqual(first([]), undefined);
  });

  it('returns null if null is the first element', () => {
    strictEqual(first([null, 1]), null);
  });

  it('returns undefined if undefined is the first element', () => {
    strictEqual(first([undefined, 1]), undefined);
  });
});
