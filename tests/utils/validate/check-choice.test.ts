import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { checkChoice } from '../../../src/utils/validate/check-choice.ts';

const CHOICES = ['horde', { value: 'alliance', label: 'Alliance' }];

describe('checkChoice', () => {
  it('passes a stored value of either choice form', () => {
    strictEqual(checkChoice('horde', CHOICES), undefined);
    strictEqual(checkChoice('alliance', CHOICES), undefined);
  });

  it('fails a label or an unknown value', () => {
    strictEqual(checkChoice('Alliance', CHOICES), 'validation.invalidChoice');
    strictEqual(checkChoice('scourge', CHOICES), 'validation.invalidChoice');
    strictEqual(checkChoice('horde', []), 'validation.invalidChoice');
  });
});
