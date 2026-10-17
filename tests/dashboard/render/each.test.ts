import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { each } from '../../../src/dashboard/render/each.ts';
import { append } from '../../../src/dashboard/render/insert.ts';
import { flush } from '../../../src/utils/reactive/_scheduler.ts';
import { ref } from '../../../src/utils/reactive/ref.ts';
import { FakeNode, FakeText } from '../_fake-dom.ts';

/**
 * A document root, whose subtree is connected, in a browser without `moveBefore`.
 */
class FakeRoot extends FakeNode {}

/**
 * A document root whose `moveBefore` refuses a node from another tree, as a browser does.
 */
class FakeDocument extends FakeRoot {
  inserts = 0;
  moves = 0;

  override insertBefore(node: FakeNode, before: FakeNode | null): FakeNode {
    this.inserts++;
    return super.insertBefore(node, before);
  }

  moveBefore(node: FakeNode, before: FakeNode | null): FakeNode {
    if (!connected(node)) throw new Error('HierarchyRequestError');
    this.moves++;
    return super.insertBefore(node, before);
  }
}

/**
 * Whether `node` sits under a `FakeRoot`.
 */
function connected(node: FakeNode): boolean {
  let root = node;
  while (root.parentNode) root = root.parentNode;
  return root instanceof FakeRoot;
}

Object.defineProperty(FakeNode.prototype, 'isConnected', {
  get(this: FakeNode) {
    return connected(this);
  },
});

/**
 * Mounts a keyed list of `items` under `root`.
 */
function mount(root: FakeNode, items: () => string[]): void {
  append(
    root as unknown as Node,
    each(
      items,
      (item) => item,
      (item) => new FakeText(item()) as unknown as Node,
    ),
  );
}

describe('each', () => {
  it('reorders rows in the document with `moveBefore`, so a focused row keeps focus', () => {
    const root = new FakeDocument();
    const items = ref(['a', 'b', 'c']);
    mount(root, () => items.value);
    const inserts = root.inserts;
    items.value = ['c', 'a', 'b'];
    flush();
    strictEqual(root.textContent, 'cab');
    strictEqual(root.inserts, inserts);
    strictEqual(root.moves > 0, true);
  });

  it('inserts a new row with `insertBefore`, since it comes from outside the document', () => {
    const root = new FakeDocument();
    const items = ref(['a', 'b']);
    mount(root, () => items.value);
    items.value = ['a', 'n', 'b'];
    flush();
    strictEqual(root.textContent, 'anb');
  });

  it('reorders with `insertBefore` where `moveBefore` is missing', () => {
    const root = new FakeRoot();
    const items = ref(['a', 'b', 'c']);
    mount(root, () => items.value);
    items.value = ['b', 'c', 'a'];
    flush();
    strictEqual(root.textContent, 'bca');
  });

  it('patches untracked, so a handler that a leaving row fires cannot subscribe the list', () => {
    const root = new FakeRoot();
    const items = ref(['a', 'b']);
    const focus = ref(0);
    let runs = 0;
    append(
      root as unknown as Node,
      each(
        () => {
          runs++;
          return items.value;
        },
        (item) => item,
        (item) => {
          const node = new FakeText(item());
          // A focused node that leaves fires `blur` at once, and its handler reads state.
          node.remove = () => {
            void focus.value;
            FakeText.prototype.remove.call(node);
          };
          return node as unknown as Node;
        },
      ),
    );
    items.value = ['a'];
    flush();
    const settled = runs;
    focus.value = 1;
    flush();
    strictEqual(root.textContent, 'a');
    strictEqual(runs, settled);
  });
});
