import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { checkStep } from '../../../src/utils/index.ts';

describe('checkStep', () => {
  it('never fails without a `step`', () => {
    strictEqual(checkStep(0.123, {}), undefined);
    strictEqual(checkStep(0.123, { min: 0 }), undefined);
  });

  it('passes a value on the grid', () => {
    strictEqual(checkStep(0.3, { step: 0.1 }), undefined);
    strictEqual(checkStep(1.75, { step: 0.5, min: 0.25 }), undefined);
  });

  it('names the step alone while the grid passes through 0', () => {
    deepStrictEqual(checkStep(0.35, { step: 0.1 }), {
      key: 'validation.invalidStep',
      params: { step: 0.1 },
    });
    deepStrictEqual(checkStep(7, { step: 5, min: 10 }), {
      key: 'validation.invalidStep',
      params: { step: 5 },
    });
  });

  it('names `min` too when it shifts the grid off 0', () => {
    deepStrictEqual(checkStep(1, { step: 0.5, min: 0.25 }), {
      key: 'validation.invalidStepFrom',
      params: { step: 0.5, min: 0.25 },
    });
  });
});
