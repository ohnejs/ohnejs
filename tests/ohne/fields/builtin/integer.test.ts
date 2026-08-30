import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { integer } from '../../../../src/ohne/fields/builtin/integer.ts';

type Ctx = Parameters<NonNullable<typeof integer.validators>[number]>[1];

const ctx = (options: Record<string, unknown> = {}) => ({ options, errors: {} }) as unknown as Ctx;

const bounds = integer.validators![0];

describe('integer bounds', () => {
  it('rejects a value below `min`', () => {
    deepStrictEqual(bounds(1, ctx({ min: 2 })), {
      key: 'validation.minValue',
      params: { min: 2 },
    });
  });

  it('rejects a value above `max`', () => {
    deepStrictEqual(bounds(11, ctx({ max: 10 })), {
      key: 'validation.maxValue',
      params: { max: 10 },
    });
  });

  it('accepts a value within bounds', () => {
    strictEqual(bounds(5, ctx({ min: 2, max: 10 })), undefined);
    strictEqual(bounds(2, ctx({ min: 2 })), undefined);
    strictEqual(bounds(10, ctx({ max: 10 })), undefined);
    strictEqual(bounds(-100, ctx()), undefined);
  });
});
