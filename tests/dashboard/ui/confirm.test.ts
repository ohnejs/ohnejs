import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { flush } from '../../../src/utils/reactive/_scheduler.ts';
import { type FakeElement, findElement } from '../_fake-dom.ts';
import { fire } from './_events.ts';

const { h } = await import('../../../src/dashboard/render/h.ts');
const { dialogHost } = await import('../../../src/dashboard/ui/dialog.ts');
const { confirm } = await import('../../../src/dashboard/ui/confirm.ts');

h('div', null, dialogHost());

const pick = (label: string): void => {
  flush();
  const root = document.body as unknown as FakeElement;
  const target = findElement(root, (el) => el.tagName === 'BUTTON' && el.textContent === label);
  fire(target!, 'click');
};

describe('confirm', () => {
  it('shows the title, the body, and the action, and resolves true on the action', async () => {
    const answer = confirm({
      title: 'Disband `Horde Vanguard`?',
      body: 'Every member leaves the guild.',
      action: 'Disband',
      destructive: true,
    });
    flush();
    const text = (document.body as unknown as FakeElement).textContent;
    strictEqual(text.includes('Disband Horde Vanguard?'), true);
    strictEqual(text.includes('Every member leaves the guild.'), true);
    pick('Disband');
    strictEqual(await answer, true);
  });

  it('resolves false on cancel', async () => {
    const answer = confirm({ title: 'Leave the raid?', action: 'Leave' });
    pick('Cancel');
    strictEqual(await answer, false);
  });
});
