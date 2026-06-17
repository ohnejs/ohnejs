import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { union } from '../../../src/utils/codegen/index.ts';

describe('union', () => {
  it('joins quoted members with a pipe', () => {
    strictEqual(union(['a', 'b']), "'a' | 'b'");
  });

  it('quotes a single member without a pipe', () => {
    strictEqual(union(['only']), "'only'");
  });

  it('escapes members through quote', () => {
    strictEqual(union(["it's"]), "'it\\'s'");
  });

  it('keeps duplicates as given', () => {
    strictEqual(union(['a', 'a']), "'a' | 'a'");
  });

  it('returns never for an empty list', () => {
    strictEqual(union([]), 'never');
  });
});
