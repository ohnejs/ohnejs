import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { flush } from '../../../src/utils/reactive/_scheduler.ts';
import { ref } from '../../../src/utils/reactive/ref.ts';
import { type FakeElement, findElement, hasClass } from '../_fake-dom.ts';
import { seedMessages } from '../_fake-messages.ts';
import './_events.ts';

await seedMessages({ 'app.desktop': 'Desktop' });

const { iconGroup } = await import('../../../src/dashboard/ui/icon-group.ts');

const item = (root: HTMLElement): FakeElement | undefined =>
  findElement(root as unknown as FakeElement, (el) => hasClass(el, 'ohne-icon-group-item'));

describe('iconGroup', () => {
  it('resolves a message key title', () => {
    const root = iconGroup(ref('desktop'), {
      choices: () => [{ value: 'desktop', icon: 'device-desktop', title: 'app.desktop' }],
    });
    flush();
    strictEqual(item(root)?.getAttribute('title'), 'Desktop');
  });

  it('keeps a getter title live', () => {
    const name = ref('Horde');
    const root = iconGroup(ref('side'), {
      choices: () => [{ value: 'side', icon: 'clock', title: () => name.value }],
    });
    flush();
    name.value = 'Alliance';
    flush();
    strictEqual(item(root)?.getAttribute('title'), 'Alliance');
  });
});
