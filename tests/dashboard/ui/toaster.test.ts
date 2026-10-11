import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { flush } from '../../../src/utils/reactive/_scheduler.ts';
import { ref } from '../../../src/utils/reactive/ref.ts';
import '../_fake-dom.ts';

Object.assign(globalThis, { window: { addEventListener: () => {} } });
Object.assign(document, { addEventListener: () => {} });

const { toaster } = await import('../../../src/dashboard/ui/toaster.ts');

describe('toaster', () => {
  it('follows a label getter', () => {
    const label = ref('Notifications alt+T');
    const section = toaster({ label: () => label.value });
    strictEqual(section.getAttribute('aria-label'), 'Notifications alt+T');
    label.value = 'Benachrichtigungen alt+T';
    flush();
    strictEqual(section.getAttribute('aria-label'), 'Benachrichtigungen alt+T');
  });
});
