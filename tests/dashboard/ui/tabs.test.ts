import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { flush } from '../../../src/utils/reactive/_scheduler.ts';
import { onCleanup } from '../../../src/utils/reactive/effect-scope.ts';
import { ref } from '../../../src/utils/reactive/ref.ts';
import '../_fake-dom.ts';

const { tab, tabs } = await import('../../../src/dashboard/ui/tabs.ts');

describe('tab', () => {
  it('builds a panel once per activation, though it reads a ref while building', () => {
    const label = ref('a');
    const active = ref<'one' | 'two'>('one');
    const stats = { builds: 0, disposals: 0 };
    tabs(
      () =>
        tab('one', () => {
          stats.builds++;
          onCleanup(() => stats.disposals++);
          return label.value;
        }),
      {
        list: () => [{ name: 'one' }, { name: 'two' }],
        active: () => active.value,
        nav: () => null,
      },
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
    const el = tabs(() => tab('one', () => [() => form.value]), {
      list: () => [{ name: 'one' }],
      active: () => 'one',
      nav: () => null,
    });
    flush();
    form.value = 'restored';
    flush();
    strictEqual(el.textContent, 'restored');
  });
});
