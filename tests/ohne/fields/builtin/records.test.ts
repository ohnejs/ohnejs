import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { records } from '../../../../src/ohne/fields/builtin/records.ts';

type Ctx = Parameters<NonNullable<typeof records.validators>[number]>[1];

const ctx = (options: Record<string, unknown> = {}) => ({ options, errors: {} }) as unknown as Ctx;

const empty = records.validators![0];
const count = records.validators![1];

describe('records emptiness', () => {
  it('rejects a provided empty list under `allowEmpty: false`', () => {
    strictEqual(empty([], ctx({ allowEmpty: false })), 'validation.emptyValue');
  });

  it('accepts an empty list under `allowEmpty: true`', () => {
    strictEqual(empty([], ctx({ allowEmpty: true })), undefined);
  });

  it('accepts a non-empty list either way', () => {
    strictEqual(empty(['u1'], ctx({ allowEmpty: false })), undefined);
  });
});

describe('records count', () => {
  it('rejects a list below `min`', () => {
    deepStrictEqual(count(['u1'], ctx({ min: 2 })), {
      key: 'validation.minItems',
      params: { min: 2 },
    });
  });

  it('rejects a list above `max`', () => {
    deepStrictEqual(count(['u1', 'u2', 'u3'], ctx({ max: 2 })), {
      key: 'validation.maxItems',
      params: { max: 2 },
    });
  });

  it('accepts a list within bounds', () => {
    strictEqual(count(['u1', 'u2'], ctx({ min: 1, max: 3 })), undefined);
    strictEqual(count([], ctx({})), undefined);
  });

  it('passes a non-array value untouched', () => {
    strictEqual(count('nope', ctx({ min: 1 })), undefined);
    strictEqual(count(null, ctx({ max: 0 })), undefined);
  });
});
