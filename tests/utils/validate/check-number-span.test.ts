import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { checkNumberSpan } from '../../../src/utils/index.ts';

describe('checkNumberSpan', () => {
  it('refuses a span that runs backwards', () => {
    strictEqual(checkNumberSpan(5, 1, {}), 'validation.invalidRange');
    strictEqual(checkNumberSpan(-1, -2, { min: 0 }), 'validation.invalidRange');
  });

  it('passes a span of 0 and one within bounds', () => {
    strictEqual(checkNumberSpan(5, 5, {}), undefined);
    strictEqual(checkNumberSpan(10, 15, { min: 5, max: 5 }), undefined);
  });

  it('compares exactly in decimal', () => {
    strictEqual(checkNumberSpan(0.1, 0.3, { min: 0.2, max: 0.2 }), undefined);
  });

  it('names a short or long span by its raw bound', () => {
    deepStrictEqual(checkNumberSpan(10, 12, { min: 5 }), {
      key: 'validation.minSpan',
      params: { min: 5 },
    });
    deepStrictEqual(checkNumberSpan(0, 2.5, { max: 2 }), {
      key: 'validation.maxSpan',
      params: { max: 2 },
    });
  });

  it('names the bound of a currency span as an `Amount`', () => {
    deepStrictEqual(checkNumberSpan(0, 900, { max: 500 }, 'EUR'), {
      key: 'validation.maxSpan',
      params: { max: { minor: 500, currency: 'EUR' } },
    });
  });
});
