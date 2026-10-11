import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { checkRequired } from '../../../src/utils/validate/check-required.ts';

describe('checkRequired', () => {
  it('fails only an absent value', () => {
    strictEqual(checkRequired(undefined), 'validation.required');
    strictEqual(checkRequired(null), undefined);
    strictEqual(checkRequired(''), undefined);
    strictEqual(checkRequired(0), undefined);
    strictEqual(checkRequired(false), undefined);
  });
});
