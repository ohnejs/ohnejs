import { deepStrictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { choiceValues } from '../../../src/utils/choice/choice-values.ts';

describe('choiceValues', () => {
  it('strips labels, keeping the order', () => {
    deepStrictEqual(choiceValues(['horde', { value: 'alliance', label: 'Alliance' }]), [
      'horde',
      'alliance',
    ]);
  });

  it('accepts labels of any type', () => {
    deepStrictEqual(choiceValues([{ value: 'scourge', label: () => 'Scourge' }]), ['scourge']);
  });

  it('returns [] for no choices', () => {
    deepStrictEqual(choiceValues([]), []);
  });
});
