import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { checkAmount } from '../../../src/utils/index.ts';

const show = (minor: number): string => `${minor / 100} EUR`;

describe('checkAmount', () => {
  it('writes the failing bound as an amount', () => {
    deepStrictEqual(checkAmount(50, { min: 100 }, show), {
      key: 'validation.minValue',
      params: { min: '1 EUR' },
    });
    deepStrictEqual(checkAmount(2500, { max: 1999 }, show), {
      key: 'validation.maxValue',
      params: { max: '19.99 EUR' },
    });
  });

  it('writes the grid of an amount off its step', () => {
    deepStrictEqual(checkAmount(150, { step: 100 }, show), {
      key: 'validation.invalidStep',
      params: { step: '1 EUR' },
    });
    deepStrictEqual(checkAmount(200, { step: 100, min: 50 }, show), {
      key: 'validation.invalidStepFrom',
      params: { step: '1 EUR', min: '0.5 EUR' },
    });
  });

  it('passes an amount within bounds', () => {
    strictEqual(checkAmount(150, { min: 100, max: 200 }, show), undefined);
  });
});
