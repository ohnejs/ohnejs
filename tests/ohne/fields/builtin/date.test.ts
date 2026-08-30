import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { date } from '../../../../src/ohne/fields/builtin/date.ts';

type Ctx = Parameters<NonNullable<typeof date.validators>[number]>[1];

const ctx = (options: Record<string, unknown> = {}) => ({ options, errors: {} }) as unknown as Ctx;

const wellFormed = date.validators![0];
const bounds = date.validators![1];

describe('date well-formedness', () => {
  it('accepts a real ISO day', () => {
    strictEqual(wellFormed('2024-06-15', ctx()), undefined);
    strictEqual(wellFormed('2024-02-29', ctx()), undefined);
  });

  it('rejects a day that does not exist', () => {
    strictEqual(wellFormed('2023-02-29', ctx()), 'validation.invalidDate');
    strictEqual(wellFormed('2024-13-01', ctx()), 'validation.invalidDate');
  });

  it('rejects a non-ISO shape', () => {
    strictEqual(wellFormed('2024-1-1', ctx()), 'validation.invalidDate');
    strictEqual(wellFormed('June 15, 2024', ctx()), 'validation.invalidDate');
  });
});

describe('date bounds', () => {
  it('rejects a day before `min`', () => {
    deepStrictEqual(bounds('2023-12-31', ctx({ min: '2024-01-01' })), {
      key: 'validation.minValue',
      params: { min: '2024-01-01' },
    });
  });

  it('rejects a day after `max`', () => {
    deepStrictEqual(bounds('2025-01-02', ctx({ max: '2025-01-01' })), {
      key: 'validation.maxValue',
      params: { max: '2025-01-01' },
    });
  });

  it('accepts a day within bounds', () => {
    strictEqual(bounds('2024-06-15', ctx({ min: '2024-01-01', max: '2024-12-31' })), undefined);
    strictEqual(bounds('2024-01-01', ctx({ min: '2024-01-01' })), undefined);
    strictEqual(bounds('2024-06-15', ctx()), undefined);
  });
});
