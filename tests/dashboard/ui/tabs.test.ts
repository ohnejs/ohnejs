import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { TabItem } from '../../../src/dashboard/ui/tabs.ts';

import { flush } from '../../../src/utils/reactive/_scheduler.ts';
import { onCleanup } from '../../../src/utils/reactive/effect-scope.ts';
import { ref } from '../../../src/utils/reactive/ref.ts';
import { FakeElement, findElement, hasClass } from '../_fake-dom.ts';
import { fire } from './_events.ts';

const { tabs } = await import('../../../src/dashboard/ui/tabs.ts');

const panelOf = (root: HTMLElement): string =>
  (root.childNodes[root.childNodes.length - 1] as unknown as FakeElement).textContent;

describe('tabs', () => {
  it('builds a panel once per activation, though it reads a ref while building', () => {
    const label = ref('a');
    const active = ref<'one' | 'two'>('one');
    const stats = { builds: 0, disposals: 0 };
    tabs(
      [
        {
          name: 'one',
          label: 'One',
          content: () => {
            stats.builds++;
            onCleanup(() => stats.disposals++);
            return label.value;
          },
        },
        { name: 'two', label: 'Two', content: () => 'two' },
      ],
      { active },
    );
    label.value = 'b';
    flush();
    strictEqual(stats.builds, 1);
    strictEqual(stats.disposals, 0);
    active.value = 'two';
    flush();
    strictEqual(stats.disposals, 1);
    active.value = 'one';
    flush();
    strictEqual(stats.builds, 2);
  });

  it('keeps a function child inside the panel live', () => {
    const form = ref('typed');
    const root = tabs([{ name: 'one', label: 'One', content: () => [() => form.value] }]);
    flush();
    form.value = 'restored';
    flush();
    strictEqual(root.textContent, 'restored');
  });

  it('shows the first tab while the active name matches none', () => {
    const active = ref<'roster' | 'loot' | 'bank'>('bank');
    const root = tabs(
      [
        { name: 'roster', label: 'Roster', content: () => 'Thrall' },
        { name: 'loot', label: 'Loot', content: () => 'Ashbringer' },
      ],
      { active },
    );
    flush();
    strictEqual(panelOf(root), 'Thrall');
  });

  it('writes the clicked tab into the active ref', () => {
    const active = ref<'roster' | 'loot'>('roster');
    const root = tabs(
      [
        { name: 'roster', label: 'Roster', content: () => 'Thrall' },
        { name: 'loot', label: 'Loot', content: () => 'Ashbringer' },
      ],
      { active },
    );
    flush();
    const loot = findElement(
      root as unknown as FakeElement,
      (element) => hasClass(element, 'ohne-button-group-item') && element.textContent === 'Loot',
    )!;
    fire(loot, 'click');
    flush();
    strictEqual(active.value, 'loot');
    strictEqual(panelOf(root), 'Ashbringer');
  });

  it('shows the tab row only with more than one tab', () => {
    const items = ref<TabItem<string>[]>([
      { name: 'roster', label: 'Roster', content: () => 'Thrall' },
    ]);
    const root = tabs(() => items.value);
    flush();
    const row = (): FakeElement | undefined =>
      findElement(root as unknown as FakeElement, (element) =>
        element.classList.has('ohne-tabs-list'),
      );
    strictEqual(row(), undefined);
    items.value = [...items.value, { name: 'loot', label: 'Loot', content: () => 'Ashbringer' }];
    flush();
    strictEqual(row()?.textContent, 'RosterLoot');
  });
});
