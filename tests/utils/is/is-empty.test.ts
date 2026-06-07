import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { isEmpty } from '../../../src/utils/index.ts';

describe('isEmpty', () => {
  it('returns true for empty strings', () => {
    strictEqual(isEmpty(''), true);
  });

  it('returns false for non-empty strings', () => {
    strictEqual(isEmpty('x'), false);
    strictEqual(isEmpty('  '), false);
  });

  it('returns true for whitespace-only strings when trim is set', () => {
    strictEqual(isEmpty('', { trim: true }), true);
    strictEqual(isEmpty('  ', { trim: true }), true);
    strictEqual(isEmpty('\t\n', { trim: true }), true);
  });

  it('returns false for non-whitespace strings when trim is set', () => {
    strictEqual(isEmpty('x ', { trim: true }), false);
  });

  it('returns true for empty arrays, Maps, Sets, and plain objects', () => {
    strictEqual(isEmpty([]), true);
    strictEqual(isEmpty(new Map()), true);
    strictEqual(isEmpty(new Set()), true);
    strictEqual(isEmpty({}), true);
    strictEqual(isEmpty(Object.create(null)), true);
  });

  it('returns false for non-empty arrays, Maps, Sets, and plain objects', () => {
    strictEqual(isEmpty([0]), false);
    strictEqual(isEmpty([undefined]), false);
    strictEqual(isEmpty(new Map([['a', 1]])), false);
    strictEqual(isEmpty(new Set([1])), false);
    strictEqual(isEmpty({ a: 1 }), false);
  });

  it('returns false for class instances that are not Map or Set', () => {
    class Counter {}
    strictEqual(isEmpty(new Counter()), false);
    strictEqual(isEmpty(new Date()), false);
    strictEqual(isEmpty(new RegExp('')), false);
  });

  it('returns false for non-container values', () => {
    strictEqual(isEmpty(null), false);
    strictEqual(isEmpty(undefined), false);
    strictEqual(isEmpty(0), false);
    strictEqual(isEmpty(false), false);
    strictEqual(isEmpty(Number.NaN), false);
    strictEqual(
      isEmpty(() => {}),
      false,
    );
    strictEqual(isEmpty(Symbol()), false);
    strictEqual(isEmpty(0n), false);
  });

  it('ignores trim option on non-strings', () => {
    strictEqual(isEmpty([], { trim: true }), true);
    strictEqual(isEmpty([1], { trim: true }), false);
    strictEqual(isEmpty(0, { trim: true }), false);
    strictEqual(isEmpty(null, { trim: true }), false);
  });
});
