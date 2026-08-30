import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { number } from '../../../../src/ohne/fields/builtin/number.ts';

type Ctx = Parameters<NonNullable<typeof number.validators>[number]>[1];

const ctx = (options: Record<string, unknown> = {}) => ({ options, errors: {} }) as unknown as Ctx;

const bounds = number.validators![0];

describe('number bounds', () => {
  it('rejects a value below `min`', () => {
    deepStrictEqual(bounds(0.5, ctx({ min: 1.5 })), {
      key: 'validation.minValue',
      params: { min: 1.5 },
    });
  });

  it('rejects a value above `max`', () => {
    deepStrictEqual(bounds(2.5, ctx({ max: 2 })), {
      key: 'validation.maxValue',
      params: { max: 2 },
    });
  });

  it('accepts a value within bounds', () => {
    strictEqual(bounds(1.25, ctx({ min: 1, max: 1.5 })), undefined);
    strictEqual(bounds(1.5, ctx({ min: 1.5 })), undefined);
    strictEqual(bounds(2, ctx({ max: 2 })), undefined);
    strictEqual(bounds(-0.5, ctx()), undefined);
  });
});
