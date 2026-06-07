import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { isSymbol } from '../../../src/utils/index.ts';

describe('isSymbol', () => {
  it('returns true for symbols', () => {
    strictEqual(isSymbol(Symbol('x')), true);
    strictEqual(isSymbol(Symbol.iterator), true);
  });

  it('returns false for non-symbols', () => {
    strictEqual(isSymbol('x'), false);
    strictEqual(isSymbol(null), false);
  });
});
