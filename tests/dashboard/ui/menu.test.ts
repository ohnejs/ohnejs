import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { MenuGroup } from '../../../src/dashboard/ui/menu.ts';

import { flush } from '../../../src/utils/reactive/_scheduler.ts';
import { ref } from '../../../src/utils/reactive/ref.ts';
import { FakeElement, findElement, hasClass } from '../_fake-dom.ts';
import { fire, trackRowFocus } from './_events.ts';
import { shapeOfDOM } from './_menu-shape.ts';

const { button } = await import('../../../src/dashboard/ui/button.ts');
const { hotkeyLabels } = await import('../../../src/dashboard/ui/hotkey-match.ts');
const { isMac } = await import('../../../src/dashboard/ui/hotkeys.ts');
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

const settled = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve));
  await new Promise((resolve) => setTimeout(resolve));
};

trackRowFocus();
Object.assign(FakeElement.prototype, {
  click(this: FakeElement) {
    fire(this, 'click');
  },
});

describe('menu', () => {
  it('opens a menu of its rows from the trigger and closes on a second click', () => {
    const trigger = fake(
      menu(button('Actions'), [
        [{ label: 'Promote to officer', icon: 'shield' }],
        [{ label: 'Remove from guild', destructive: true }],
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
        [{ label: 'Summon', onSelect: () => calls.push(panel() ? 'open' : 'closed') }],
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
        [
          {
            label: 'Open the vault',
            disabled: () => locked.value,
            onSelect: () => calls.push('open'),
          },
        ],
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

  it('closes on Escape and marks it handled, so no page hotkey takes it', async () => {
    const trigger = fake(menu(button('Actions'), [[{ label: 'Hearthstone' }]]));
    fire(trigger, 'click');
    flush();
    await settled();
    const event = fire(body(), 'keydown', { key: 'Escape', code: 'Escape' });
    flush();
    deepStrictEqual([panel(), event.defaultPrevented], [undefined, true]);
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
      const trigger = fake(menu(button('Raid', { size: -3 }), [[{ label: 'Ulduar' }]]));
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

  it('focuses its first enabled row when the keyboard opens it, and the panel on a pointer open', async () => {
    const locked = ref(true);
    const trigger = fake(
      menu(button('Actions'), [
        [{ label: 'Open the vault', disabled: () => locked.value }, { label: 'Hearthstone' }],
      ]),
    );
    fire(trigger, 'click', { detail: 0 });
    flush();
    await settled();
    strictEqual(document.activeElement, row('Hearthstone'));
    fire(trigger, 'click', { detail: 0 });
    flush();
    fire(trigger, 'click', { detail: 1 });
    flush();
    await settled();
    strictEqual(document.activeElement, panel());
    fire(trigger, 'click', { detail: 1 });
    flush();
  });

  it('picks the enabled row whose hotkey is pressed while it is open', () => {
    const keydowns = new Set<(event: unknown) => void>();
    const { addEventListener, removeEventListener } = document;
    Object.assign(document, {
      addEventListener: (type: string, listener: (event: unknown) => void) => {
        if (type === 'keydown') keydowns.add(listener);
      },
      removeEventListener: (type: string, listener: (event: unknown) => void) => {
        if (type === 'keydown') keydowns.delete(listener);
      },
    });
    const picked: string[] = [];
    const trigger = fake(
      menu(button('Actions'), [
        [
          { label: 'Duplicate', hotkey: 'duplicate', onSelect: () => picked.push('duplicate') },
          {
            label: 'Delete',
            hotkey: 'delete',
            disabled: () => true,
            onSelect: () => picked.push('delete'),
          },
        ],
      ]),
    );
    fire(trigger, 'click');
    flush();
    const press = (keys: Record<string, unknown>) => {
      const event = {
        key: '',
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
        metaKey: false,
        ...keys,
        defaultPrevented: false,
        preventDefault: () => (event.defaultPrevented = true),
        stopPropagation() {},
      };
      for (const listener of keydowns) listener(event);
      return event.defaultPrevented;
    };
    const disabled = press({ key: 'Backspace' });
    const duplicate = press({ key: 'd', [isMac() ? 'metaKey' : 'ctrlKey']: true });
    flush();
    Object.assign(document, { addEventListener, removeEventListener });
    deepStrictEqual(
      [disabled, duplicate, picked, panel(), keydowns.size],
      [false, true, ['duplicate'], undefined, 0],
    );
  });

  it('shows the platform label of a row hotkey as a hint, and names it to assistive tech', () => {
    const trigger = fake(
      menu(button('Actions'), [
        [{ label: 'Duplicate', icon: 'copy', hotkey: 'duplicate' }, { label: 'Rename' }],
      ]),
    );
    fire(trigger, 'click');
    flush();
    const keys = hotkeyLabels(isMac()).duplicate.split(' + ');
    const duplicate = row(`Duplicate${keys.join('')}`);
    const hint = findElement(duplicate, (element) => element.tagName === 'KBD')!;
    deepStrictEqual(
      [
        hint.childNodes.map((key) => (key as FakeElement).textContent),
        hint.getAttribute('aria-hidden'),
        duplicate.getAttribute('aria-keyshortcuts'),
      ],
      [keys, 'true', isMac() ? 'Meta+D' : 'Control+D'],
    );
    strictEqual(
      findElement(row('Rename'), (element) => element.tagName === 'KBD'),
      undefined,
    );
    strictEqual(row('Rename').getAttribute('aria-keyshortcuts'), null);
    fire(trigger, 'click');
    flush();
  });

  it('drops skipped rows and empty groups, with one divider between the groups left', () => {
    const officer = false;
    const cases: [MenuGroup[], string][] = [
      [[[], [{ label: 'Invite' }, officer && { label: 'Promote' }], [undefined], []], 'Invite'],
      [[[{ label: 'Invite' }], [false], [{ label: 'Whisper' }]], 'Invite | Whisper'],
      [
        [[{ label: 'Invite' }, undefined], [{ label: 'Whisper' }], [], [{ label: 'Kick' }]],
        'Invite | Whisper | Kick',
      ],
      [
        [[{ label: 'Duplicate', hotkey: 'duplicate' }], [{ label: 'Kick', hotkey: 'delete' }]],
        'Duplicate[duplicate] | Kick[delete]',
      ],
    ];
    deepStrictEqual(
      cases.map(([groups]) => {
        const trigger = fake(menu(button('Actions'), groups));
        fire(trigger, 'click');
        flush();
        const shape = shapeOfDOM(panel()!);
        fire(trigger, 'click');
        flush();
        return shape;
      }),
      cases.map(([, shape]) => shape),
    );
  });

  it('opens nothing on a click while every group is empty', () => {
    const trigger = fake(menu(button('Actions'), [[], [false, undefined]]));
    fire(trigger, 'click');
    flush();
    deepStrictEqual([panel(), trigger.getAttribute('aria-expanded')], [undefined, 'false']);
  });

  it('reads its groups on each click, so a getter opens once it has a row', () => {
    const rows = ref<MenuGroup[]>([[]]);
    const trigger = fake(menu(button('Actions'), () => rows.value));
    fire(trigger, 'click');
    flush();
    strictEqual(panel(), undefined);
    rows.value = [[{ label: 'Hearthstone' }]];
    fire(trigger, 'click');
    flush();
    strictEqual(panel()?.textContent, 'Hearthstone');
    fire(trigger, 'click');
    flush();
  });
});
