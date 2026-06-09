import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { capitalize } from '../../../src/utils/index.ts';

describe('capitalize', () => {
  it('uppercases the first character of a lowercase string', () => {
    strictEqual(capitalize('hello'), 'Hello');
  });

  it('returns an already-capitalized string unchanged', () => {
    strictEqual(capitalize('Hello'), 'Hello');
  });

  it('only touches the first character, leaving the rest as-is', () => {
    strictEqual(capitalize('hELLO wORLD'), 'HELLO wORLD');
  });

  it('returns an empty string unchanged', () => {
    strictEqual(capitalize(''), '');
  });

  it('handles single-character strings', () => {
    strictEqual(capitalize('a'), 'A');
    strictEqual(capitalize('A'), 'A');
  });

  it('leaves leading whitespace alone', () => {
    strictEqual(capitalize(' hello'), ' hello');
  });

  it('returns non-letter leading characters unchanged', () => {
    strictEqual(capitalize('1abc'), '1abc');
    strictEqual(capitalize('-abc'), '-abc');
  });

  it('preserves unicode beyond the first character', () => {
    strictEqual(capitalize('café'), 'Café');
  });
});
