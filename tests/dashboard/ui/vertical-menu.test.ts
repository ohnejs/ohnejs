import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { flush } from '../../../src/utils/reactive/_scheduler.ts';
import { ref } from '../../../src/utils/reactive/ref.ts';
import { type FakeElement, findElement } from '../_fake-dom.ts';

const { verticalMenu } = await import('../../../src/dashboard/ui/vertical-menu.ts');

describe('verticalMenu', () => {
  it('follows an expand label getter', () => {
    const label = ref('Expand');
    const root = verticalMenu({
      items: () => [{ label: 'Posts', submenu: [{ label: 'Drafts', to: '/drafts' }] }],
      ariaExpandLabel: () => label.value,
    }) as unknown as FakeElement;
    flush();
    const button = findElement(root, (element) => element.attributes.has('aria-expanded'));
    strictEqual(button?.getAttribute('aria-label'), 'Expand');
    label.value = 'Ausklappen';
    flush();
    strictEqual(button?.getAttribute('aria-label'), 'Ausklappen');
  });
});
