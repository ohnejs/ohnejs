import { notStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { append } from '../../../src/dashboard/render/insert.ts';
import { when } from '../../../src/dashboard/render/when.ts';
import { flush } from '../../../src/utils/reactive/_scheduler.ts';
import { onCleanup } from '../../../src/utils/reactive/effect-scope.ts';
import { ref } from '../../../src/utils/reactive/ref.ts';
import { FakeComment, FakeNode, FakeText } from '../_fake-dom.ts';

/**
 * Mounts `child` under a fresh root and returns the root.
 */
function mount(child: unknown): FakeNode {
  const root = new FakeNode();
  append(root as unknown as Node, child as Parameters<typeof append>[1]);
  return root;
}

/**
 * The first non-comment node under `root`, the branch's built element.
 */
function built(root: FakeNode): FakeNode | undefined {
  return root.childNodes.find((node) => !(node instanceof FakeComment));
}

/**
 * A branch builder that reads `source` while building, counting builds and disposals.
 */
function branch(source: { value: string }) {
  const stats = { builds: 0, disposals: 0 };
  const build = () => {
    stats.builds++;
    onCleanup(() => stats.disposals++);
    return new FakeText(source.value) as unknown as Node;
  };
  return { stats, build };
}

describe('when', () => {
  it('keeps the `then` branch when a ref it read while building changes', () => {
    const label = ref('a');
    const { stats, build } = branch(label);
    const root = mount(when(() => true, build));
    const first = built(root);
    label.value = 'b';
    flush();
    strictEqual(stats.builds, 1);
    strictEqual(stats.disposals, 0);
    strictEqual(built(root), first);
  });

  it('keeps the `otherwise` branch when a ref it read while building changes', () => {
    const label = ref('a');
    const { stats, build } = branch(label);
    const root = mount(
      when(
        () => false,
        () => null,
        build,
      ),
    );
    const first = built(root);
    label.value = 'b';
    flush();
    strictEqual(stats.builds, 1);
    strictEqual(stats.disposals, 0);
    strictEqual(built(root), first);
  });

  it('rebuilds when the condition flips, disposing the outgoing branch', () => {
    const open = ref(true);
    const label = ref('a');
    const yes = branch(label);
    const no = branch(label);
    const root = mount(when(() => open.value, yes.build, no.build));
    const first = built(root);
    open.value = false;
    flush();
    strictEqual(root.textContent, 'a');
    strictEqual(yes.stats.disposals, 1);
    strictEqual(no.stats.builds, 1);
    open.value = true;
    flush();
    strictEqual(yes.stats.builds, 2);
    strictEqual(no.stats.disposals, 1);
    notStrictEqual(built(root), first);
  });

  it('disposes an `otherwise`-only branch when the condition turns truthy', () => {
    const open = ref(false);
    const label = ref('a');
    const { stats, build } = branch(label);
    const root = mount(
      when(
        () => open.value,
        () => null,
        build,
      ),
    );
    strictEqual(root.textContent, 'a');
    open.value = true;
    flush();
    strictEqual(root.textContent, '');
    strictEqual(stats.disposals, 1);
    open.value = false;
    flush();
    strictEqual(root.textContent, 'a');
    strictEqual(stats.builds, 2);
  });

  it('keeps the branch when the condition changes value but not truthiness', () => {
    const count = ref(1);
    const label = ref('a');
    const { stats, build } = branch(label);
    mount(when(() => count.value, build));
    count.value = 2;
    flush();
    strictEqual(stats.builds, 1);
  });

  it('still updates a reactive child inside the branch, in place', () => {
    const label = ref('a');
    let builds = 0;
    const root = mount(
      when(
        () => true,
        () => {
          builds++;
          return () => label.value;
        },
      ),
    );
    label.value = 'b';
    flush();
    strictEqual(root.textContent, 'b');
    strictEqual(builds, 1);
  });
});
