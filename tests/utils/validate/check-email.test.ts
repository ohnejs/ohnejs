import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { checkEmail } from '../../../src/utils/index.ts';

describe('checkEmail', () => {
  it('accepts an email address', () => {
    strictEqual(checkEmail('thrall@orgrimmar.example'), undefined);
  });

  it('names anything else an invalid email', () => {
    strictEqual(checkEmail(''), 'validation.invalidEmail');
    strictEqual(checkEmail('thrall'), 'validation.invalidEmail');
  });
});
