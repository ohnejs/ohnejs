import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { FakeElement } from '../_fake-dom.ts';

import { flush } from '../../../src/utils/reactive/_scheduler.ts';
import { ref } from '../../../src/utils/reactive/ref.ts';
import { fire } from './_events.ts';

const { disclosure } = await import('../../../src/dashboard/ui/disclosure.ts');

const fake = (element: HTMLElement): FakeElement => element as unknown as FakeElement;

describe('disclosure', () => {
  it('builds its content on the first open and keeps it after closing', () => {
    const open = ref(false);
    let builds = 0;
    const root = disclosure(
      () => {
        builds++;
        return 'Hearthstones cool down after thirty minutes.';
      },
      { summary: 'Cooldowns', open },
    );
    flush();
    strictEqual(builds, 0);
    strictEqual(root.getAttribute('open'), null);
    open.value = true;
    flush();
    strictEqual(root.getAttribute('open'), '');
    open.value = false;
    flush();
    strictEqual(builds, 1);
    strictEqual(root.textContent, 'CooldownsHearthstones cool down after thirty minutes.');
  });

  it('writes a native toggle back into the open ref', () => {
    const open = ref(false);
    const root = disclosure(() => 'Need before greed.', { summary: 'Loot rules', open });
    Object.assign(root, { open: true });
    fire(fake(root), 'toggle');
    strictEqual(open.value, true);
  });

  it('names its details element after the group', () => {
    const root = disclosure(() => 'Bring flasks.', { summary: 'Raid rules', group: 'faq' });
    strictEqual(root.getAttribute('name'), 'faq');
    strictEqual(root.tagName, 'DETAILS');
  });
});
