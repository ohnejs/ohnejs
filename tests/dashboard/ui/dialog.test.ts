import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { flush } from '../../../src/utils/reactive/_scheduler.ts';
import { ref } from '../../../src/utils/reactive/ref.ts';
import { type FakeElement, findElement, hasClass } from '../_fake-dom.ts';
import { seedMessages } from '../_fake-messages.ts';
import './_events.ts';

await seedMessages({ 'app.disband': 'Disband', 'app.sure': 'Disband the guild?' });

const { h } = await import('../../../src/dashboard/render/h.ts');
const { dialogHost, openDialog } = await import('../../../src/dashboard/ui/dialog.ts');

h('div', null, dialogHost());

const body = (): FakeElement => document.body as unknown as FakeElement;
const action = (): FakeElement | undefined =>
  findElement(body(), (el) => el.tagName === 'BUTTON' && hasClass(el, 'ohne-button'));
const content = (): FakeElement | undefined =>
  findElement(body(), (el) => hasClass(el, 'ohne-dialog-content'));

describe('openDialog', () => {
  it('resolves a message key label and content', () => {
    void openDialog({ content: 'app.sure', actions: [{ name: 'disband', label: 'app.disband' }] });
    flush();
    strictEqual(action()?.textContent, 'Disband');
    strictEqual(content()?.textContent, 'Disband the guild?');
  });

  it('keeps a getter label and content live', () => {
    const name = ref('Horde');
    void openDialog({
      content: () => `Leave the ${name.value}?`,
      actions: [{ name: 'leave', label: () => name.value }],
    });
    flush();
    name.value = 'Alliance';
    flush();
    strictEqual(action()?.textContent, 'Alliance');
    strictEqual(content()?.textContent, 'Leave the Alliance?');
  });
});
