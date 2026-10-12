import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { flush } from '../../../src/utils/reactive/_scheduler.ts';
import { ref } from '../../../src/utils/reactive/ref.ts';
import { FakeElement, findElement, hasClass } from '../_fake-dom.ts';
import { fire } from './_events.ts';

const { button } = await import('../../../src/dashboard/ui/button.ts');
const { menu } = await import('../../../src/dashboard/ui/menu.ts');

const fake = (element: HTMLElement): FakeElement => element as unknown as FakeElement;
const body = (): FakeElement => document.body as unknown as FakeElement;
const panel = (): FakeElement | undefined =>
  findElement(body(), (element) => element.getAttribute('role') === 'menu');
const row = (text: string): FakeElement =>
  findElement(
    panel()!,
    (element) => element.getAttribute('role') === 'menuitem' && element.textContent === text,
  )!;

describe('menu', () => {
  it('opens a menu of its rows from the trigger and closes on a second click', () => {
    const trigger = fake(
      menu(button('Actions'), [
        { label: 'Promote to officer', icon: 'shield' },
        '---',
        { label: 'Remove from guild', destructive: true },
      ]),
    );
    flush();
    strictEqual(trigger.getAttribute('aria-haspopup'), 'menu');
    strictEqual(trigger.getAttribute('aria-expanded'), 'false');
    fire(trigger, 'click');
    flush();
    strictEqual(trigger.getAttribute('aria-expanded'), 'true');
    strictEqual(panel()?.textContent, 'Promote to officerRemove from guild');
    strictEqual(findElement(panel()!, (element) => element.tagName === 'HR') !== undefined, true);
    strictEqual(hasClass(row('Remove from guild'), 'ohne-dropdown-item-indent'), true);
    strictEqual(hasClass(row('Promote to officer'), 'ohne-dropdown-item-indent'), false);
    fire(trigger, 'click');
    flush();
    strictEqual(panel(), undefined);
    strictEqual(trigger.getAttribute('aria-expanded'), 'false');
  });

  it('closes before it runs the picked action', () => {
    const calls: string[] = [];
    const trigger = fake(
      menu(button('Actions'), [
        { label: 'Summon', onSelect: () => calls.push(panel() ? 'open' : 'closed') },
      ]),
    );
    fire(trigger, 'click');
    flush();
    fire(row('Summon'), 'click');
    deepStrictEqual(calls, ['closed']);
  });

  it('ignores a pick on a disabled row and marks it', () => {
    const locked = ref(true);
    const calls: string[] = [];
    const trigger = fake(
      menu(button('Actions'), [
        {
          label: 'Open the vault',
          disabled: () => locked.value,
          onSelect: () => calls.push('open'),
        },
      ]),
    );
    fire(trigger, 'click');
    flush();
    const vault = row('Open the vault');
    strictEqual(vault.getAttribute('aria-disabled'), 'true');
    strictEqual(fire(vault, 'click').defaultPrevented, true);
    deepStrictEqual(calls, []);
    strictEqual(panel() !== undefined, true);
    fire(trigger, 'click');
  });

  it('sizes its panel like the text around a compact trigger, though it mounts on the body', () => {
    const computed = globalThis.getComputedStyle;
    const context = new FakeElement('div');
    Object.assign(globalThis, {
      getComputedStyle: (element: unknown) => ({
        display: 'inline',
        getPropertyValue: () => (element === context ? ' -1' : '-3'),
      }),
    });
    try {
      const trigger = fake(menu(button('Raid', { size: -3 }), [{ label: 'Ulduar' }]));
      context.appendChild(trigger);
      fire(trigger, 'click');
      flush();
      strictEqual(panel()?.getAttribute('style')?.includes('--ohne-size: -1;'), true);
      fire(trigger, 'click');
      flush();
    } finally {
      Object.assign(globalThis, { getComputedStyle: computed });
    }
  });
});
