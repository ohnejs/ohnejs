import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { repeater } from '../../../../src/ohne/fields/builtin/repeater.ts';

type Ctx = Parameters<NonNullable<typeof repeater.validators>[number]>[1];

const ctx = (options: Record<string, unknown> = {}) => ({ options, errors: {} }) as unknown as Ctx;

const empty = repeater.validators![0];
const count = repeater.validators![1];

describe('repeater emptiness', () => {
  it('rejects a provided empty list under `allowEmpty: false`', () => {
    strictEqual(empty([], ctx({ allowEmpty: false })), 'validation.emptyValue');
  });

  it('accepts an empty list under `allowEmpty: true`', () => {
    strictEqual(empty([], ctx({ allowEmpty: true })), undefined);
  });

  it('accepts a non-empty list either way', () => {
    strictEqual(empty([{}], ctx({ allowEmpty: false })), undefined);
  });
});

describe('repeater count', () => {
  it('rejects a list below `min`', () => {
    deepStrictEqual(count([{}], ctx({ min: 2 })), {
      key: 'validation.minItems',
      params: { min: 2 },
    });
  });

  it('rejects a list above `max`', () => {
    deepStrictEqual(count([{}, {}, {}], ctx({ max: 2 })), {
      key: 'validation.maxItems',
      params: { max: 2 },
    });
  });

  it('accepts a list within bounds', () => {
    strictEqual(count([{}, {}], ctx({ min: 1, max: 3 })), undefined);
    strictEqual(count([], ctx({})), undefined);
  });

  it('passes a non-array value untouched', () => {
    strictEqual(count('nope', ctx({ min: 1 })), undefined);
    strictEqual(count(null, ctx({ max: 0 })), undefined);
  });
});
