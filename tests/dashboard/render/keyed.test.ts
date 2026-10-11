import { notStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { append } from '../../../src/dashboard/render/insert.ts';
import { keyed } from '../../../src/dashboard/render/keyed.ts';
import { flush } from '../../../src/utils/reactive/_scheduler.ts';
import { onCleanup } from '../../../src/utils/reactive/effect-scope.ts';
import { ref } from '../../../src/utils/reactive/ref.ts';
import { FakeComment, FakeNode, FakeText } from '../_fake-dom.ts';

/**
 * Mounts `child` under a fresh root and returns the root.
 */
function mount(child: () => unknown): FakeNode {
  const root = new FakeNode();
  append(root as unknown as Node, child as Parameters<typeof append>[1]);
  return root;
}

/**
 * The first non-comment node under `root`, the built child.
 */
function built(root: FakeNode): FakeNode | undefined {
  return root.childNodes.find((node) => !(node instanceof FakeComment));
}

describe('keyed', () => {
  it('rebuilds when the key changes, disposing the outgoing child', () => {
    const key = ref('a');
    let builds = 0;
    let disposals = 0;
    const root = mount(
      keyed(
        () => key.value,
        () => {
          builds++;
          onCleanup(() => disposals++);
          return new FakeText(key.value) as unknown as Node;
        },
      ),
    );
    const first = built(root);
    key.value = 'b';
    flush();
    strictEqual(root.textContent, 'b');
    strictEqual(builds, 2);
    strictEqual(disposals, 1);
    notStrictEqual(built(root), first);
  });

  it('keeps the child when the key re-runs to the same value', () => {
    const source = ref({ view: 'grid', page: 1 });
    let builds = 0;
    mount(
      keyed(
        () => source.value.view,
        () => {
          builds++;
          return null;
        },
      ),
    );
    source.value = { view: 'grid', page: 2 };
    flush();
    strictEqual(builds, 1);
  });

  it('keeps the child when a ref it read while building changes', () => {
    const key = ref(1);
    const label = ref('a');
    let builds = 0;
    const root = mount(
      keyed(
        () => key.value,
        () => {
          builds++;
          return new FakeText(label.value) as unknown as Node;
        },
      ),
    );
    label.value = 'b';
    flush();
    strictEqual(builds, 1);
    strictEqual(root.textContent, 'a');
  });

  it('treats `NaN` as equal to itself', () => {
    const key = ref<number | string>(Number.NaN);
    let builds = 0;
    mount(
      keyed(
        () => (typeof key.value === 'string' ? Number.NaN : key.value),
        () => {
          builds++;
          return null;
        },
      ),
    );
    key.value = 'nan';
    flush();
    strictEqual(builds, 1);
  });
});
