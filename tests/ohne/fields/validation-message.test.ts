import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { failureMessage } from '../../../src/ohne/fields/validation-message.ts';

describe('failureMessage', () => {
  it('passes a pass and a bare key through', () => {
    strictEqual(failureMessage(undefined), undefined);
    strictEqual(failureMessage('validation.emptyValue'), 'validation.emptyValue');
  });

  it('turns a parameterized failure into its message object', () => {
    deepStrictEqual(failureMessage({ key: 'validation.minLength', params: { min: 3 } }), {
      key: 'validation.minLength',
      params: { min: 3 },
    });
  });
});
