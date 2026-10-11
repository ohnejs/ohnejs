import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { checkText } from '../../../src/utils/validate/check-text.ts';

describe('checkText', () => {
  it('rejects an empty string unless `allowEmpty` is set', () => {
    strictEqual(checkText(''), 'validation.emptyValue');
    strictEqual(checkText('', { allowEmpty: false }), 'validation.emptyValue');
    strictEqual(checkText('', { allowEmpty: true }), undefined);
  });

  it('checks the empty string before the length', () => {
    strictEqual(checkText('', { min: 3 }), 'validation.emptyValue');
    deepStrictEqual(checkText('', { allowEmpty: true, min: 3 }), {
      key: 'validation.minLength',
      params: { min: 3 },
    });
  });

  it('bounds the length in UTF-16 units', () => {
    deepStrictEqual(checkText('Orc', { min: 4 }), {
      key: 'validation.minLength',
      params: { min: 4 },
    });
    deepStrictEqual(checkText('Grommash', { max: 5 }), {
      key: 'validation.maxLength',
      params: { max: 5 },
    });
    strictEqual(checkText('Thrall', { min: 6, max: 6 }), undefined);
    deepStrictEqual(checkText('\u{1F43A}', { max: 1 }), {
      key: 'validation.maxLength',
      params: { max: 1 },
    });
  });
});
