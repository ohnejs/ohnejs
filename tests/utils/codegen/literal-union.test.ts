import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { literalUnion } from '../../../src/utils/codegen/index.ts';

describe('literalUnion', () => {
  it('joins quoted members with a pipe', () => {
    strictEqual(literalUnion(['a', 'b']), "'a' | 'b'");
  });

  it('quotes a single member without a pipe', () => {
    strictEqual(literalUnion(['only']), "'only'");
  });

  it('escapes members through literalString', () => {
    strictEqual(literalUnion(["it's"]), "'it\\'s'");
  });

  it('keeps duplicates as given', () => {
    strictEqual(literalUnion(['a', 'a']), "'a' | 'a'");
  });

  it('returns never for an empty list', () => {
    strictEqual(literalUnion([]), 'never');
  });
});
