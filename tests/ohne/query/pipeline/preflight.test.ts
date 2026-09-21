import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { coerceColumn, isValidColumn } from '../../../../src/ohne/query/pipeline/preflight.ts';

describe('coerceColumn', () => {
  it('soft-coerces toward the storage primitive', () => {
    strictEqual(coerceColumn('42', 'integer'), 42);
    strictEqual(coerceColumn('1.5', 'real'), 1.5);
    strictEqual(coerceColumn(1, 'boolean'), true);
    strictEqual(coerceColumn(42, 'text'), '42');
  });

  it('keeps a fractional string fractional under integer, so the gate rejects it', () => {
    strictEqual(coerceColumn('1.9', 'integer'), 1.9);
    strictEqual(coerceColumn('-1.9', 'integer'), -1.9);
    strictEqual(isValidColumn(coerceColumn('1.9', 'integer'), 'integer'), false);
    strictEqual(coerceColumn('1.0', 'integer'), 1);
    strictEqual(coerceColumn('1e3', 'integer'), 1000);
  });

  it('normalizes -0 to 0', () => {
    strictEqual(Object.is(coerceColumn(-0, 'real'), 0), true);
    strictEqual(Object.is(coerceColumn('-0', 'real'), 0), true);
    strictEqual(Object.is(coerceColumn('-0', 'integer'), 0), true);
  });

  it('passes a value it cannot convert through unchanged', () => {
    strictEqual(coerceColumn('nope', 'integer'), 'nope');
    strictEqual(coerceColumn('Infinity', 'real'), 'Infinity');
  });

  it('leaves a json value untouched', () => {
    const value = { a: 1 };
    strictEqual(coerceColumn(value, 'json'), value);
  });
});

describe('isValidColumn', () => {
  it('accepts a value of the right primitive', () => {
    strictEqual(isValidColumn('x', 'text'), true);
    strictEqual(isValidColumn(3, 'integer'), true);
    strictEqual(isValidColumn(1.5, 'real'), true);
    strictEqual(isValidColumn(true, 'boolean'), true);
  });

  it('rejects a wrong-typed or non-safe value', () => {
    strictEqual(isValidColumn('3', 'integer'), false);
    strictEqual(isValidColumn(Number.MAX_SAFE_INTEGER + 2, 'integer'), false);
    strictEqual(isValidColumn(1, 'text'), false);
  });

  it('gates a real column on finiteness alone', () => {
    strictEqual(isValidColumn(2 ** 53, 'real'), true);
    strictEqual(isValidColumn(NaN, 'real'), false);
    strictEqual(isValidColumn(-Infinity, 'real'), false);
    strictEqual(isValidColumn('1.5', 'real'), false);
  });

  it('accepts any value for a json column', () => {
    strictEqual(isValidColumn({ a: 1 }, 'json'), true);
    strictEqual(isValidColumn([1, 2], 'json'), true);
  });
});
