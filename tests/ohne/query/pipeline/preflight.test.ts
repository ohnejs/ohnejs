import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { coerceColumn, isValidColumn } from '../../../../src/ohne/query/pipeline/preflight.ts';

describe('coerceColumn', () => {
  it('soft-coerces toward the storage primitive', () => {
    strictEqual(coerceColumn('42', 'integer'), 42);
    strictEqual(coerceColumn(1, 'boolean'), true);
    strictEqual(coerceColumn(42, 'text'), '42');
  });

  it('passes a value it cannot convert through unchanged', () => {
    strictEqual(coerceColumn('nope', 'integer'), 'nope');
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
    strictEqual(isValidColumn(true, 'boolean'), true);
  });

  it('rejects a wrong-typed or non-safe value', () => {
    strictEqual(isValidColumn('3', 'integer'), false);
    strictEqual(isValidColumn(Number.MAX_SAFE_INTEGER + 2, 'integer'), false);
    strictEqual(isValidColumn(1, 'text'), false);
  });

  it('accepts any value for a json column', () => {
    strictEqual(isValidColumn({ a: 1 }, 'json'), true);
    strictEqual(isValidColumn([1, 2], 'json'), true);
  });
});
