import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { flush } from '../../../src/utils/reactive/_scheduler.ts';
import { ref } from '../../../src/utils/reactive/ref.ts';
import '../_fake-dom.ts';

const { alert } = await import('../../../src/dashboard/ui/alert.ts');

describe('alert', () => {
  it('follows a title getter', () => {
    const title = ref('Locked');
    const element = alert('Body', { title: () => title.value });
    strictEqual(element.textContent, 'LockedBody');
    title.value = 'Gesperrt';
    flush();
    strictEqual(element.textContent, 'GesperrtBody');
  });
});
