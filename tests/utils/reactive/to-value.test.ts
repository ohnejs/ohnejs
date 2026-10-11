import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { effect } from '../../../src/utils/reactive/effect.ts';
import { ref } from '../../../src/utils/reactive/ref.ts';
import { toValue } from '../../../src/utils/reactive/to-value.ts';

describe('toValue', () => {
  it('answers a plain value as is', () => {
    strictEqual(toValue('Close'), 'Close');
  });

  it('calls a getter', () => {
    strictEqual(
      toValue(() => 'Save'),
      'Save',
    );
  });

  it('subscribes the running effect to what a getter reads', () => {
    const label = ref('Save');
    const seen: string[] = [];
    effect(() => {
      seen.push(toValue(() => label.value));
    });
    label.value = 'Speichern';
    strictEqual(seen.join('|'), 'Save|Speichern');
  });
});
