import { deepStrictEqual, notStrictEqual, ok, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import {
  activeTreeItems,
  addTreeItemsAfter,
  addTreeItemsBefore,
  cloneTreeItem,
  deleteTreeItems,
  dropTreeItems,
  flatTreeItems,
  flatTreeItemsWithLevel,
  getChildTreeItems,
  getParentTreeItems,
  moveTreeItems,
  normalizeTreeSelection,
  sortTreeItems,
  type TreeItemModel,
  type TreeModel,
  useTree,
} from '../../../src/dashboard/ui/tree-model.ts';

interface VNode {
  id: string;
  children?: VNode[];
}

function leaf(id: string): TreeItemModel<VNode> {
  return { id, source: { id }, nestable: false };
}

function branch(
  id: string,
  children: TreeItemModel<VNode>[],
  expanded = false,
): TreeItemModel<VNode> {
  return { id, source: { id }, nestable: true, children, expanded };
}

function ids(items: { id: string | number }[]): (string | number)[] {
  return items.map(({ id }) => id);
}

function sample(): TreeModel<VNode> {
  return [branch('a', [leaf('a1'), branch('a2', [leaf('a2x')], true)], true), leaf('b'), leaf('c')];
}

describe('flatTreeItems', () => {
  it('flattens depth-first regardless of expansion', () => {
    const tree = sample();
    (tree[0] as { expanded?: boolean }).expanded = false;
    deepStrictEqual(ids(flatTreeItems(tree)), ['a', 'a1', 'a2', 'a2x', 'b', 'c']);
  });

  it('skips children of non-nestable items', () => {
    const rogue = leaf('x') as TreeItemModel<VNode> & { children?: TreeItemModel<VNode>[] };
    rogue.children = [leaf('y')];
    deepStrictEqual(ids(flatTreeItems([rogue])), ['x']);
  });
});

describe('flatTreeItemsWithLevel', () => {
  it('tracks nesting levels', () => {
    deepStrictEqual(
      flatTreeItemsWithLevel(sample()).map(([item, level]) => [item.id, level]),
      [
        ['a', 0],
        ['a1', 1],
        ['a2', 1],
        ['a2x', 2],
        ['b', 0],
        ['c', 0],
      ],
    );
  });
});

describe('sortTreeItems', () => {
  it('sorts in place by tree appearance', () => {
    const tree = sample();
    const a2 = (tree[0] as { children: TreeItemModel<VNode>[] }).children[1]!;
    const a2x = (a2 as { children: TreeItemModel<VNode>[] }).children[0]!;
    const items = [tree[2]!, a2x, tree[0]!];
    const result = sortTreeItems(items, tree);
    strictEqual(result, items);
    deepStrictEqual(ids(result), ['a', 'a2x', 'c']);
  });
});

describe('getParentTreeItems', () => {
  it('orders parents from the root to the immediate parent', () => {
    const tree = sample();
    const a2 = (tree[0] as { children: TreeItemModel<VNode>[] }).children[1]!;
    const a2x = (a2 as { children: TreeItemModel<VNode>[] }).children[0]!;
    deepStrictEqual(ids(getParentTreeItems(a2x, tree)), ['a', 'a2']);
  });

  it('returns an empty array for root items', () => {
    const tree = sample();
    deepStrictEqual(getParentTreeItems(tree[1]!, tree), []);
  });
});

describe('getChildTreeItems', () => {
  it('collects all nested children in tree order', () => {
    const tree = sample();
    deepStrictEqual(ids(getChildTreeItems(tree[0]!, tree)), ['a1', 'a2', 'a2x']);
  });

  it('stops at the first equal-or-shallower entry', () => {
    const tree = sample();
    const a2 = (tree[0] as { children: TreeItemModel<VNode>[] }).children[1]!;
    deepStrictEqual(ids(getChildTreeItems(a2, tree)), ['a2x']);
  });
});

describe('normalizeTreeSelection', () => {
  it('drops descendants of selected ancestors and duplicates', () => {
    const tree = sample();
    const a = tree[0]!;
    const a1 = (a as { children: TreeItemModel<VNode>[] }).children[0]!;
    deepStrictEqual(ids(normalizeTreeSelection([a, a1, a, tree[2]!], tree)), ['a', 'c']);
  });
});

describe('addTreeItemsBefore', () => {
  it('splices into the root slot and reports indexes', () => {
    const tree = sample();
    const added = addTreeItemsBefore([leaf('n1'), leaf('n2')], tree[1]!, tree);
    deepStrictEqual(ids(tree), ['a', 'n1', 'n2', 'b', 'c']);
    deepStrictEqual(
      added.map(({ index, parent }) => [index, parent?.id]),
      [
        [1, undefined],
        [2, undefined],
      ],
    );
  });

  it('splices into a parent slot with the parent reported', () => {
    const tree = sample();
    const a1 = (tree[0] as { children: TreeItemModel<VNode>[] }).children[0]!;
    const added = addTreeItemsBefore([leaf('n')], a1, tree);
    deepStrictEqual(ids((tree[0] as { children: TreeItemModel<VNode>[] }).children), [
      'n',
      'a1',
      'a2',
    ]);
    deepStrictEqual(
      added.map(({ index, parent }) => [index, parent?.id]),
      [[0, 'a']],
    );
  });
});

describe('addTreeItemsAfter', () => {
  it('splices after the target', () => {
    const tree = sample();
    const added = addTreeItemsAfter([leaf('n1'), leaf('n2')], tree[1]!, tree);
    deepStrictEqual(ids(tree), ['a', 'b', 'n1', 'n2', 'c']);
    deepStrictEqual(
      added.map(({ index }) => index),
      [2, 3],
    );
  });
});

describe('moveTreeItems', () => {
  it('moves movable items and skips immovable ones', () => {
    const tree = [{ ...leaf('a'), movable: true }, { ...leaf('b'), movable: true }, leaf('c')];
    const moved = moveTreeItems([tree[1]!], tree, 'up');
    deepStrictEqual(ids(tree), ['b', 'a', 'c']);
    deepStrictEqual(
      moved.map(({ oldIndex, newIndex }) => [oldIndex, newIndex]),
      [[1, 0]],
    );
    deepStrictEqual(moveTreeItems([tree[2]!], tree, 'up'), []);
  });

  it('compresses a stacked selection at the top without crossing', () => {
    const tree = [
      { ...leaf('a'), movable: true },
      { ...leaf('b'), movable: true },
      { ...leaf('c'), movable: true },
    ];
    moveTreeItems([tree[0]!, tree[1]!], tree, 'up');
    deepStrictEqual(ids(tree), ['a', 'b', 'c']);
  });

  it('compresses a stacked selection at the bottom without crossing', () => {
    const tree = [
      { ...leaf('a'), movable: true },
      { ...leaf('b'), movable: true },
      { ...leaf('c'), movable: true },
    ];
    moveTreeItems([tree[1]!, tree[2]!], tree, 'down');
    deepStrictEqual(ids(tree), ['a', 'b', 'c']);
  });

  it('shares the ratchet across parent slots, exactly as the source', () => {
    const child = { ...leaf('a1'), movable: true };
    const tree = [
      branch('a', [child, { ...leaf('a2'), movable: true }], true),
      { ...leaf('b'), movable: true },
    ];
    const moved = moveTreeItems([child, tree[1]!], tree, 'up');
    deepStrictEqual(
      moved.map(({ item, oldIndex, newIndex }) => [item.id, oldIndex, newIndex]),
      [
        ['a1', 0, 0],
        ['b', 1, 1],
      ],
    );
    deepStrictEqual(ids(tree), ['a', 'b']);
  });

  it('never invokes a function `movable`, treating it as truthy', () => {
    const tree = [leaf('a'), { ...leaf('b'), movable: () => false }];
    moveTreeItems([tree[1]!], tree, 'up');
    deepStrictEqual(ids(tree), ['b', 'a']);
  });
});

describe('dropTreeItems', () => {
  it('unshifts into the target on an inside drop', () => {
    const tree = sample();
    const target = tree[0]!;
    const dropped = dropTreeItems([tree[1]!, tree[2]!], target, tree, 'inside');
    deepStrictEqual(ids(tree), ['a']);
    deepStrictEqual(ids((target as { children: TreeItemModel<VNode>[] }).children), [
      'b',
      'c',
      'a1',
      'a2',
    ]);
    deepStrictEqual(
      dropped.map(({ item, oldIndex, newIndex, newParent }) => [
        item.id,
        oldIndex,
        newIndex,
        newParent?.id,
      ]),
      [
        ['b', 1, 0, 'a'],
        ['c', 1, 1, 'a'],
      ],
    );
  });

  it('creates the children array on an inside drop when missing', () => {
    const tree: TreeModel<VNode> = [{ id: 'a', source: { id: 'a' }, nestable: true }, leaf('b')];
    dropTreeItems([tree[1]!], tree[0]!, tree, 'inside');
    deepStrictEqual(ids((tree[0] as { children: TreeItemModel<VNode>[] }).children), ['b']);
  });

  it('adjusts the insertion index for same-slot removals above it', () => {
    const tree = [leaf('a'), leaf('b'), leaf('c'), leaf('d')];
    const dropped = dropTreeItems([tree[0]!], tree[2]!, tree, 'after');
    deepStrictEqual(ids(tree), ['b', 'c', 'a', 'd']);
    deepStrictEqual(
      dropped.map(({ oldIndex, newIndex }) => [oldIndex, newIndex]),
      [[0, 2]],
    );
  });

  it('drops before a nested target into its parent slot', () => {
    const tree = sample();
    const a1 = (tree[0] as { children: TreeItemModel<VNode>[] }).children[0]!;
    const dropped = dropTreeItems([tree[1]!], a1, tree, 'before');
    deepStrictEqual(ids(tree), ['a', 'c']);
    deepStrictEqual(ids((tree[0] as { children: TreeItemModel<VNode>[] }).children), [
      'b',
      'a1',
      'a2',
    ]);
    deepStrictEqual(
      dropped.map(({ oldParent, newParent, newIndex }) => [oldParent?.id, newParent?.id, newIndex]),
      [[undefined, 'a', 0]],
    );
  });
});

describe('deleteTreeItems', () => {
  it('removes items and reports their parents', () => {
    const tree = sample();
    const a1 = (tree[0] as { children: TreeItemModel<VNode>[] }).children[0]!;
    const deleted = deleteTreeItems([a1, tree[1]!], tree);
    deepStrictEqual(ids(tree), ['a', 'c']);
    deepStrictEqual(ids((tree[0] as { children: TreeItemModel<VNode>[] }).children), ['a2']);
    deepStrictEqual(
      deleted.map(({ item, parent }) => [item.id, parent?.id]),
      [
        ['a1', 'a'],
        ['b', undefined],
      ],
    );
  });
});

describe('activeTreeItems', () => {
  it('projects only expanded rows', () => {
    const tree = sample();
    deepStrictEqual(
      activeTreeItems(tree).map(({ item }) => item.id),
      ['a', 'a1', 'a2', 'a2x', 'b', 'c'],
    );

    (
      (tree[0] as { children: TreeItemModel<VNode>[] }).children[1] as { expanded?: boolean }
    ).expanded = false;
    deepStrictEqual(
      activeTreeItems(tree).map(({ item }) => item.id),
      ['a', 'a1', 'a2', 'b', 'c'],
    );
  });

  it('carries slot indexes, nearest-first parents, and visible descendants', () => {
    const rows = activeTreeItems(sample());
    const a2x = rows.find(({ item }) => item.id === 'a2x')!;
    strictEqual(a2x.index, 0);
    deepStrictEqual(
      a2x.parents.map(({ item }) => item.id),
      ['a2', 'a'],
    );
    const a = rows[0]!;
    strictEqual(a.index, 0);
    deepStrictEqual(
      a.descendants.map(({ item }) => item.id),
      ['a1', 'a2', 'a2x'],
    );
  });
});

describe('cloneTreeItem', () => {
  it('deep-clones the item and assigns new 23-character alphabetic ids', () => {
    const original = branch('a', [leaf('a1')], true);
    const clone = cloneTreeItem(original);
    notStrictEqual(clone, original);
    notStrictEqual(clone.source, original.source);
    ok(/^[A-Za-z]{23}$/.test(String(clone.id)));
    ok(
      /^[A-Za-z]{23}$/.test(
        String((clone as { children: TreeItemModel<VNode>[] }).children[0]!.id),
      ),
    );
    strictEqual(original.id, 'a');
  });

  it('writes the new id into the source when given the id property', () => {
    const clone = cloneTreeItem(leaf('a'), 'id');
    strictEqual(clone.source.id, clone.id);
  });

  it('keeps functions by reference', () => {
    const draggable = (): boolean => true;
    const clone = cloneTreeItem({ ...leaf('a'), draggable });
    strictEqual(clone.draggable, draggable);
  });
});

describe('useTree', () => {
  const mapper = (nodes: VNode[]): TreeModel<VNode> =>
    nodes.map((node) => ({
      id: node.id,
      source: node,
      nestable: true,
      children: mapper(node.children ?? []),
    }));

  it('builds the tree from the source and refreshes it', () => {
    const source: VNode[] = [{ id: 'a', children: [{ id: 'a1' }] }];
    const { tree, refresh } = useTree(source, mapper);
    deepStrictEqual(ids(tree.value), ['a']);

    source.push({ id: 'b' });
    const before = tree.value;
    refresh();
    notStrictEqual(tree.value, before);
    deepStrictEqual(ids(tree.value), ['a', 'b']);
  });

  it('appends and prepends at the root and under nestable parents', () => {
    const { tree, appendItems, prependItems } = useTree<VNode>([], () => []);
    appendItems([leaf('b')]);
    prependItems([leaf('a')]);
    deepStrictEqual(ids(tree.value), ['a', 'b']);

    const parent = branch('p', []);
    appendItems([parent]);
    appendItems([leaf('p1')], parent);
    prependItems([leaf('p0')], parent);
    deepStrictEqual(ids((parent as { children: TreeItemModel<VNode>[] }).children), ['p0', 'p1']);
  });

  it('falls back to the root for a non-nestable parent', () => {
    const item = leaf('a');
    const { tree, appendItems } = useTree<VNode>([], () => []);
    appendItems([item]);
    appendItems([leaf('b')], item);
    deepStrictEqual(ids(tree.value), ['a', 'b']);
  });

  it('re-sets the tree ref after every mutation so dependents re-run', () => {
    const { tree, appendItems, moveItems, deleteItems } = useTree<VNode>([], () => []);
    const a = { ...leaf('a'), movable: true };
    const b = { ...leaf('b'), movable: true };

    let before = tree.value;
    appendItems([a, b]);
    notStrictEqual(tree.value, before);

    before = tree.value;
    moveItems([b], 'up');
    notStrictEqual(tree.value, before);
    deepStrictEqual(ids(tree.value), ['b', 'a']);

    before = tree.value;
    deleteItems([a]);
    notStrictEqual(tree.value, before);
    deepStrictEqual(ids(tree.value), ['b']);
  });

  it('delegates drops to the pure helper', () => {
    const parent = branch('p', []);
    const item = leaf('a');
    const { tree, dropItems } = useTree<VNode>([], () => []);
    tree.value.push(parent, item);

    const dropped = dropItems([item], parent, 'inside');
    deepStrictEqual(ids(tree.value), ['p']);
    deepStrictEqual(
      dropped.map(({ item: it, newParent }) => [it.id, newParent?.id]),
      [['a', 'p']],
    );
  });
});
