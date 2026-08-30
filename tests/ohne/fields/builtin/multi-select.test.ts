import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { multiSelect } from '../../../../src/ohne/fields/builtin/multi-select.ts';

type ValidateCtx = Parameters<NonNullable<typeof multiSelect.validators>[number]>[1];
type WriteCtx = Parameters<NonNullable<typeof multiSelect.sanitizers>[number]>[1];
type EmitCtx = Parameters<NonNullable<typeof multiSelect.emitType>>[0];

const ctx = (options: Record<string, unknown>) =>
  ({ options, errors: {} }) as unknown as ValidateCtx;

const emitCtx = (options: Record<string, unknown>) => ({ options }) as unknown as EmitCtx;

const sanitize = multiSelect.sanitizers![0];
const shape = multiSelect.validators![0];
const membership = multiSelect.validators![1];
const count = multiSelect.validators![2];

describe('multiSelect emitType', () => {
  it('emits `string[]` without choices', () => {
    strictEqual(multiSelect.emitType!(emitCtx({})), 'string[]');
  });

  it('emits the wrapped choice union with choices', () => {
    strictEqual(multiSelect.emitType!(emitCtx({ choices: ['a', 'b'] })), "('a' | 'b')[]");
    strictEqual(
      multiSelect.emitType!(emitCtx({ choices: [{ value: 'a', label: 'A' }, 'b'] })),
      "('a' | 'b')[]",
    );
  });
});

describe('multiSelect sanitizer', () => {
  it('collapses duplicates, keeping the first occurrence', () => {
    deepStrictEqual(sanitize(['a', 'b', 'a', 'c', 'b'], {} as WriteCtx), ['a', 'b', 'c']);
  });

  it('passes a non-array through untouched', () => {
    strictEqual(sanitize('a', {} as WriteCtx), 'a');
  });
});

describe('multiSelect shape', () => {
  it('accepts an array of strings', () => {
    strictEqual(shape(['a', 'b'], ctx({})), undefined);
    strictEqual(shape([], ctx({})), undefined);
  });

  it('rejects a non-array value', () => {
    strictEqual(shape('a', ctx({})), 'validation.invalidValue');
  });

  it('rejects an entry that is not a string', () => {
    strictEqual(shape(['a', 1], ctx({})), 'validation.invalidValue');
  });
});

describe('multiSelect membership', () => {
  it('accepts entries from the choice list', () => {
    const context = ctx({ choices: ['a', { value: 'b', label: 'B' }] });
    strictEqual(membership(['a', 'b'], context), undefined);
    deepStrictEqual(context.errors, {});
  });

  it('records an indexed error per illegal entry', () => {
    const context = ctx({ choices: ['a', 'b'] });
    strictEqual(membership(['a', 'x', 'b', 'y'], context), undefined);
    deepStrictEqual(context.errors, {
      '[1]': 'validation.invalidChoice',
      '[3]': 'validation.invalidChoice',
    });
  });

  it('accepts any strings without choices', () => {
    const context = ctx({});
    strictEqual(membership(['whatever'], context), undefined);
    deepStrictEqual(context.errors, {});
  });
});

describe('multiSelect count', () => {
  it('rejects a list below `min`', () => {
    deepStrictEqual(count(['a'], ctx({ min: 2 })), {
      key: 'validation.minItems',
      params: { min: 2 },
    });
  });

  it('rejects a list above `max`', () => {
    deepStrictEqual(count(['a', 'b', 'c'], ctx({ max: 2 })), {
      key: 'validation.maxItems',
      params: { max: 2 },
    });
  });

  it('accepts a list within bounds', () => {
    strictEqual(count(['a', 'b'], ctx({ min: 1, max: 3 })), undefined);
    strictEqual(count([], ctx({})), undefined);
  });
});
