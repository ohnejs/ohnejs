import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { flush } from '../../../src/utils/reactive/_scheduler.ts';
import { ref } from '../../../src/utils/reactive/ref.ts';
import { type FakeElement, findElement, hasClass } from '../_fake-dom.ts';
import { fire } from './_events.ts';

const { card } = await import('../../../src/dashboard/ui/card.ts');

const fake = (element: HTMLElement): FakeElement => element as unknown as FakeElement;
const part = (root: HTMLElement, name: string): FakeElement | undefined =>
  findElement(fake(root), (element) => hasClass(element, name));

describe('card', () => {
  it('builds the header from its title, badge, actions, and more link', () => {
    const title = ref('Raid roster');
    const root = card('Thrall', {
      title: () => title.value,
      badge: 'Full',
      actions: 'Invite',
      more: { href: '/raids' },
    });
    flush();
    strictEqual(part(root, 'ohne-card-head')?.textContent, 'Raid rosterFullInviteView all');
    strictEqual(part(root, 'ohne-card-more')?.getAttribute('href'), '/raids');
    title.value = 'Raid bench';
    flush();
    strictEqual(part(root, 'ohne-card-title')?.textContent, 'Raid bench');
  });

  it('draws no header without header options', () => {
    const root = card('Thrall');
    strictEqual(fake(root).childNodes.length, 1);
  });

  it('keeps a raw header over the built one', () => {
    const root = card('Thrall', { header: 'Custom', title: 'Ignored' });
    strictEqual(root.textContent, 'CustomThrall');
  });

  it('shows an error state when a function body throws', () => {
    const error = console.error;
    console.error = () => {};
    try {
      const root = card(() => {
        throw new Error('The portal collapsed');
      });
      flush();
      strictEqual(
        findElement(fake(root), (element) => element.getAttribute('role') === 'alert')?.textContent,
        'Failed to load',
      );
    } finally {
      console.error = error;
    }
  });

  it('folds the body and footer through the open ref and the toggle', () => {
    const open = ref(true);
    const root = card('Thrall', { title: 'Roster', footer: 'Updated', collapsible: { open } });
    flush();
    const toggle = findElement(fake(root), (element) => element.tagName === 'BUTTON')!;
    strictEqual(toggle.getAttribute('aria-expanded'), 'true');
    strictEqual(part(root, 'ohne-card-body')?.getAttribute('hidden'), null);
    open.value = false;
    flush();
    strictEqual(toggle.getAttribute('aria-expanded'), 'false');
    strictEqual(part(root, 'ohne-card-body')?.getAttribute('hidden'), '');
    strictEqual(part(root, 'ohne-card-footer')?.getAttribute('hidden'), '');
    fire(toggle, 'click');
    flush();
    strictEqual(open.value, true);
    strictEqual(
      toggle.getAttribute('aria-controls'),
      part(root, 'ohne-card-body')?.getAttribute('id'),
    );
  });

  it('marks a flush body and a destructive tone', () => {
    const root = card('Thrall', { flush: true, tone: 'destructive' });
    flush();
    strictEqual(hasClass(fake(root), 'ohne-card-destructive'), true);
    strictEqual(part(root, 'ohne-card-body-flush')?.textContent, 'Thrall');
  });
});
