import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { checkAmount } from '../../../src/utils/index.ts';

describe('checkAmount', () => {
  it('names the failing bound as an `Amount`', () => {
    deepStrictEqual(checkAmount(50, { min: 100 }, 'EUR'), {
      key: 'validation.minValue',
      params: { min: { minor: 100, currency: 'EUR' } },
    });
    deepStrictEqual(checkAmount(2500, { max: 1999 }, 'EUR'), {
      key: 'validation.maxValue',
      params: { max: { minor: 1999, currency: 'EUR' } },
    });
  });

  it('names the grid of an amount off its step as `Amount`s', () => {
    deepStrictEqual(checkAmount(150, { step: 100 }, 'EUR'), {
      key: 'validation.invalidStep',
      params: { step: { minor: 100, currency: 'EUR' } },
    });
    deepStrictEqual(checkAmount(200, { step: 100, min: 50 }, 'EUR'), {
      key: 'validation.invalidStepFrom',
      params: { step: { minor: 100, currency: 'EUR' }, min: { minor: 50, currency: 'EUR' } },
    });
  });

  it('passes an amount within bounds', () => {
    strictEqual(checkAmount(150, { min: 100, max: 200 }, 'EUR'), undefined);
  });
});
