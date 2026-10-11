import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { flush } from '../../../src/utils/reactive/_scheduler.ts';
import { ref } from '../../../src/utils/reactive/ref.ts';
import { type FakeElement, findElement, hasClass } from '../_fake-dom.ts';
import { seedMessages } from '../_fake-messages.ts';
import './_events.ts';

await seedMessages({ 'app.draft': 'Draft' });

const { buttonGroup } = await import('../../../src/dashboard/ui/button-group.ts');

const item = (root: HTMLElement): FakeElement | undefined =>
  findElement(root as unknown as FakeElement, (el) => hasClass(el, 'ohne-button-group-item'));

describe('buttonGroup', () => {
  it('resolves a message key label', () => {
    const root = buttonGroup(ref('draft'), {
      choices: () => [{ value: 'draft', label: 'app.draft' }],
    });
    flush();
    strictEqual(item(root)?.textContent, 'Draft');
  });

  it('keeps a getter label live', () => {
    const name = ref('Horde');
    const root = buttonGroup(ref('side'), {
      choices: () => [{ value: 'side', label: () => name.value }],
    });
    flush();
    name.value = 'Alliance';
    flush();
    strictEqual(item(root)?.textContent, 'Alliance');
  });
});
