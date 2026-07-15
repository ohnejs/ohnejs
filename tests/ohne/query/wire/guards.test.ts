import { deepStrictEqual, doesNotThrow, strictEqual, throws } from 'node:assert';
import { describe, it } from 'node:test';

import {
  assertBoundParams,
  DEFAULT_QUERY_GUARDS,
  resolveGuards,
} from '../../../../src/ohne/query/wire/guards.ts';

describe('resolveGuards', () => {
  it('returns the framework defaults when nothing overrides', () => {
    deepStrictEqual(resolveGuards(), DEFAULT_QUERY_GUARDS);
  });

  it('overrides a single guard, keeping the rest at their defaults', () => {
    const resolved = resolveGuards({ maxPerPage: 5 });
    strictEqual(resolved.maxPerPage, 5);
    strictEqual(resolved.maxSelect, DEFAULT_QUERY_GUARDS.maxSelect);
  });

  it('overrides several guards at once', () => {
    const resolved = resolveGuards({ maxPerPage: 5, maxSelect: 10 });
    strictEqual(resolved.maxPerPage, 5);
    strictEqual(resolved.maxSelect, 10);
  });

  it('returns a fresh table, never mutating the defaults', () => {
    resolveGuards({ maxPerPage: 1 });
    strictEqual(DEFAULT_QUERY_GUARDS.maxPerPage, 500);
  });
});

describe('assertBoundParams', () => {
  it('accepts a count at or below the cap', () => {
    doesNotThrow(() => assertBoundParams(0));
    doesNotThrow(() => assertBoundParams(DEFAULT_QUERY_GUARDS.maxBoundParams));
  });

  it('throws when the count exceeds the cap', () => {
    throws(() => assertBoundParams(DEFAULT_QUERY_GUARDS.maxBoundParams + 1));
  });
});
