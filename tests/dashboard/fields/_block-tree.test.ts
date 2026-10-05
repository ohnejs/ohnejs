import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { TreeItemModel } from '../../../src/dashboard/ui/tree-model.ts';

import {
  type BlockSlots,
  type BlockTreeRow,
  type TreeBlock,
  type TreeBlockList,
  blockTreeModel,
  canDrop,
  dropDestination,
  placeBlocks,
  stepBlocks,
} from '../../../src/dashboard/fields/_block-tree.ts';

type Node = TreeBlock & { slots?: { name: string; list: List }[] };
type List = TreeBlockList<Node> & { commits: number };

let key = 0;

const node = (block: string, slots?: { name: string; list: List }[]): Node => ({
  $key: (key += 1),
  block,
  form: {},
  slots,
});

/**
 * A list that adopts a foreign node as a copy with a fresh key, as the real control does.
 */
const list = (nodes: Node[], offered = ['Hero', 'Columns', 'Text']): List => {
  let current = nodes;
  const own = new Set(nodes.map((entry) => entry.form));
  const handle: List = {
    offered,
    disabled: false,
    commits: 0,
    nodes: () => current,
    commit(next) {
      handle.commits += 1;
      current = next.map((entry) => {
        if (own.has(entry.form)) return entry;
        const copy = node(entry.block);
        own.add(copy.form);
        return copy;
      });
      return current;
    },
  };
  return handle;
};

const slots: BlockSlots<Node> = (entry) =>
  (entry.slots ?? []).map((slot) => ({ name: slot.name, label: slot.name, list: slot.list }));

const blocks = (target: List) => target.nodes().map((entry) => entry.block);

const row = (model: TreeItemModel<BlockTreeRow<Node>>[], id: string | number) => {
  const walk = (
    items: TreeItemModel<BlockTreeRow<Node>>[],
  ): TreeItemModel<BlockTreeRow<Node>> | undefined => {
    for (const item of items) {
      if (item.id === id) return item;
      const found = item.nestable ? walk(item.children ?? []) : undefined;
      if (found) return found;
    }
    return undefined;
  };
  const found = walk(model);
  if (!found) throw new Error(`row ${id} missing`);
  return found;
};

describe('blockTreeModel', () => {
  it('nests one blocks field directly and several behind slot rows', () => {
    const inner = node('Text');
    const single = node('Columns', [{ name: 'items', list: list([inner]) }]);
    const left = node('Text');
    const double = node('Columns', [
      { name: 'left', list: list([left]) },
      { name: 'right', list: list([]) },
    ]);
    const model = blockTreeModel(list([single, double]), slots, () => false);

    const first = row(model, single.$key);
    strictEqual(first.nestable && first.children?.[0]?.id, inner.$key);
    const second = row(model, double.$key);
    deepStrictEqual(
      second.nestable && second.children?.map((child) => [child.id, child.selectable]),
      [
        [`${double.$key}.left`, false],
        [`${double.$key}.right`, false],
      ],
    );
    strictEqual(row(model, left.$key).source.kind, 'block');
  });

  it('keeps a folded row folded', () => {
    const parent = node('Columns', [{ name: 'items', list: list([node('Text')]) }]);
    const model = blockTreeModel(list([parent]), slots, (id) => id === parent.$key);
    const item = row(model, parent.$key);
    strictEqual(item.nestable && item.expanded, false);
  });

  it('locks dragging in a disabled list', () => {
    const locked = list([node('Text')]);
    locked.disabled = true;
    strictEqual(blockTreeModel(locked, slots, () => false)[0]?.draggable, false);
  });
});

describe('dropDestination and canDrop', () => {
  const inner = list([]);
  const a = node('Hero');
  const b = node('Columns', [{ name: 'items', list: inner }]);
  const root = list([a, b]);
  const model = blockTreeModel(root, slots, () => false);

  it('lands beside a block, and first inside its one blocks field', () => {
    deepStrictEqual(dropDestination(row(model, a.$key), 'after', slots), { list: root, index: 1 });
    deepStrictEqual(dropDestination(row(model, b.$key), 'inside', slots), {
      list: inner,
      index: 0,
    });
    strictEqual(dropDestination(row(model, a.$key), 'inside', slots), undefined);
  });

  it('refuses a block type the destination does not admit', () => {
    const narrow = list([], ['Text']);
    const host = node('Columns', [{ name: 'items', list: narrow }]);
    const tree = blockTreeModel(list([a, host]), slots, () => false);
    strictEqual(canDrop([row(tree, a.$key)], row(tree, host.$key), 'inside', slots), false);
    strictEqual(canDrop([row(tree, a.$key)], row(tree, host.$key), 'after', slots), true);
  });
});

describe('placeBlocks', () => {
  it('reorders inside one list without remounting', () => {
    const [a, b, c] = [node('Hero'), node('Text'), node('Columns')];
    const root = list([a, b, c]);
    const placed = placeBlocks({ list: root, index: 3 }, [{ node: a, list: root }]);
    deepStrictEqual(blocks(root), ['Text', 'Columns', 'Hero']);
    strictEqual(placed[0], a);
    strictEqual(root.commits, 1);
  });

  it('moves across lists: the receiver adopts a copy, then the giver drops it', () => {
    const a = node('Hero');
    const from = list([a, node('Text')]);
    const to = list([node('Columns')]);
    const placed = placeBlocks({ list: to, index: 0 }, [{ node: a, list: from }]);
    deepStrictEqual(blocks(to), ['Hero', 'Columns']);
    deepStrictEqual(blocks(from), ['Text']);
    strictEqual(placed[0]?.block, 'Hero');
    strictEqual(placed[0] === a, false);
  });
});

describe('stepBlocks', () => {
  const [a, b, c] = [node('Hero'), node('Text'), node('Columns')];

  it('steps a contiguous selection together', () => {
    deepStrictEqual(stepBlocks([a, b, c], new Set([b.form, c.form]), -1), [b, c, a]);
    deepStrictEqual(stepBlocks([a, b, c], new Set([a.form, b.form]), 1), [c, a, b]);
  });

  it('leaves a selection at the edge in place', () => {
    deepStrictEqual(stepBlocks([a, b, c], new Set([a.form, b.form]), -1), [a, b, c]);
    deepStrictEqual(stepBlocks([a, b, c], new Set([c.form]), 1), [a, b, c]);
  });
});
