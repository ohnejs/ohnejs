import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { last } from '../../../src/utils/index.ts';

describe('last', () => {
  it('returns the last element', () => {
    strictEqual(last([1, 2, 3]), 3);
  });

  it('returns the only element', () => {
    strictEqual(last(['a']), 'a');
  });

  it('returns undefined for an empty array', () => {
    strictEqual(last([]), undefined);
  });

  it('returns null if null is the last element', () => {
    strictEqual(last([1, null]), null);
  });

  it('returns undefined if undefined is the last element', () => {
    strictEqual(last([1, undefined]), undefined);
  });
});
