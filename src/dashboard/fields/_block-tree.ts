import type { TreeDropTarget, TreeItemModel, TreeModel } from '../ui/tree-model.ts';

import { isUndefined } from '../../utils/is/is-undefined.ts';

/**
 * The parts of a block the tree reads.
 * `form` identifies the block, since expanding a card replaces the node object.
 */
export interface TreeBlock {
  $key: number;
  block: string;
  form: object;
}

/**
 * The parts of a `blocks` list the tree drives.
 */
export interface TreeBlockList<N extends TreeBlock> {
  offered: readonly string[];
  disabled: boolean;
  nodes(): readonly N[];
  commit(next: readonly N[]): N[];
}

/**
 * One row of a blocks tree.
 * A block row sits in `list`.
 * A slot row stands for one `blocks` field of `owner`, shown when the block has several.
 */
export type BlockTreeRow<N extends TreeBlock> =
  | { kind: 'block'; node: N; list: TreeBlockList<N> }
  | { kind: 'slot'; name: string; label: string; list: TreeBlockList<N>; owner: N };

/**
 * The `blocks` lists a block holds, one per `blocks` field, in field order.
 */
export type BlockSlots<N extends TreeBlock> = (
  node: N,
) => { name: string; label: string; list: TreeBlockList<N> }[];

/**
 * Where a drop lands: a list and the index in its current nodes.
 */
export interface BlockDestination<N extends TreeBlock> {
  list: TreeBlockList<N>;
  index: number;
}

/**
 * Builds the tree model over `list`, descending into every block's `blocks` lists.
 * A block with one `blocks` field shows its children directly; one with several shows a slot row per field.
 * `collapsed` answers whether a row the user folded stays folded.
 */
export function blockTreeModel<N extends TreeBlock>(
  list: TreeBlockList<N>,
  slots: BlockSlots<N>,
  collapsed: (id: string | number) => boolean,
): TreeModel<BlockTreeRow<N>> {
  const editable = !list.disabled;
  const droppable = (
    selection: TreeItemModel<BlockTreeRow<N>>[],
    target: TreeItemModel<BlockTreeRow<N>>,
    zone: TreeDropTarget<BlockTreeRow<N>>['zone'],
  ): boolean => canDrop(selection, target, zone, slots);

  const rows = (from: TreeBlockList<N>): TreeModel<BlockTreeRow<N>> =>
    from.nodes().map((node) => {
      const held = slots(node);
      const source: BlockTreeRow<N> = { kind: 'block', node, list: from };
      const common = { id: node.$key, source, draggable: editable, movable: editable, droppable };
      if (held.length === 0) return { ...common, nestable: false };
      const children =
        held.length === 1
          ? rows((held[0] as { list: TreeBlockList<N> }).list)
          : held.map((slot) => {
              const id = `${node.$key}.${slot.name}`;
              return {
                id,
                source: {
                  kind: 'slot',
                  name: slot.name,
                  label: slot.label,
                  list: slot.list,
                  owner: node,
                },
                selectable: false,
                droppable,
                nestable: true,
                expanded: !collapsed(id),
                children: rows(slot.list),
              } satisfies TreeItemModel<BlockTreeRow<N>>;
            });
      return { ...common, nestable: true, expanded: !collapsed(node.$key), children };
    });

  return rows(list);
}

/**
 * The list and index a drop on `target` lands in, or `undefined` when the zone takes no blocks.
 * Inside a block with exactly one `blocks` field, or inside a slot, lands first in that list.
 * Before or after a block lands beside it.
 */
export function dropDestination<N extends TreeBlock>(
  target: TreeItemModel<BlockTreeRow<N>>,
  zone: TreeDropTarget<BlockTreeRow<N>>['zone'],
  slots: BlockSlots<N>,
): BlockDestination<N> | undefined {
  const row = target.source;
  if (row.kind === 'slot') return zone === 'inside' ? { list: row.list, index: 0 } : undefined;
  if (zone === 'inside') {
    const held = slots(row.node);
    return held.length === 1
      ? { list: (held[0] as { list: TreeBlockList<N> }).list, index: 0 }
      : undefined;
  }
  const index = row.list.nodes().findIndex((node) => node.form === row.node.form);
  return { list: row.list, index: zone === 'after' ? index + 1 : index };
}

/**
 * Whether the `selection` may drop on `target`: every row a block the destination list admits.
 */
export function canDrop<N extends TreeBlock>(
  selection: TreeItemModel<BlockTreeRow<N>>[],
  target: TreeItemModel<BlockTreeRow<N>>,
  zone: TreeDropTarget<BlockTreeRow<N>>['zone'],
  slots: BlockSlots<N>,
): boolean {
  const destination = dropDestination(target, zone, slots);
  if (isUndefined(destination) || destination.list.disabled) return false;
  return selection.every(
    ({ source }) => source.kind === 'block' && destination.list.offered.includes(source.node.block),
  );
}

/**
 * Moves `moving` into `destination` and answers the placed nodes.
 * The destination commits first, so a block from another list is copied before its own list drops it.
 */
export function placeBlocks<N extends TreeBlock>(
  destination: BlockDestination<N>,
  moving: readonly { node: N; list: TreeBlockList<N> }[],
): N[] {
  const forms = new Set(moving.map(({ node }) => node.form));
  const current = destination.list.nodes();
  const at = current.slice(0, destination.index).filter((node) => !forms.has(node.form)).length;
  const rest = current.filter((node) => !forms.has(node.form));
  const placed = destination.list.commit([
    ...rest.slice(0, at),
    ...moving.map(({ node }) => node),
    ...rest.slice(at),
  ]);
  for (const list of new Set(moving.map((entry) => entry.list))) {
    if (list !== destination.list)
      list.commit(list.nodes().filter((node) => !forms.has(node.form)));
  }
  return placed.slice(at, at + moving.length);
}

/**
 * The `nodes` with every block in `moving` stepped one place by `delta`.
 * A block blocked by the edge, or by a moving neighbour that is blocked, stays put.
 *
 * @example
 * ```ts
 * stepBlocks([a, b, c], new Set([b.form, c.form]), -1) // -> [b, c, a]
 * stepBlocks([a, b, c], new Set([a.form]), -1)         // -> [a, b, c]
 * ```
 */
export function stepBlocks<N extends TreeBlock>(
  nodes: readonly N[],
  moving: ReadonlySet<object>,
  delta: -1 | 1,
): N[] {
  const next = [...nodes];
  const order =
    delta === -1 ? next.map((_, index) => index) : next.map((_, index) => next.length - 1 - index);
  const stuck = new Set<object>();
  for (const index of order) {
    const node = next[index] as N;
    if (!moving.has(node.form)) continue;
    const swap = index + delta;
    const neighbour = next[swap];
    if (isUndefined(neighbour) || stuck.has(neighbour.form)) {
      stuck.add(node.form);
      continue;
    }
    next[swap] = node;
    next[index] = neighbour;
  }
  return next;
}
