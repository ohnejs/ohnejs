import { last } from '../../utils/array/last.ts';
import { clamp } from '../../utils/number/clamp.ts';
import { type Ref, ref } from '../../utils/reactive/ref.ts';

/**
 * The tree model: the root-level tree items.
 */
export type TreeModel<T> = TreeItemModel<T>[];

/**
 * One item of a tree model.
 */
export type TreeItemModel<T> = {
  /**
   * A unique value to identify the tree item.
   */
  id: string | number;

  /**
   * The source data of the tree item.
   */
  source: T;

  /**
   * An optional label to display for the tree item.
   * If not provided, the `id` is displayed instead.
   */
  label?: string;

  /**
   * Specifies whether the tree item can be dragged.
   * If a function is provided, it is called with the `item` as the only argument.
   * The function should return a boolean indicating whether the `item` can be dragged.
   *
   * @default
   * false
   */
  draggable?: boolean | ((item: TreeItemModel<T>) => boolean);

  /**
   * Specifies whether the selected tree items can be dropped on a target.
   * If a function is provided, it is called with the current `selection`, the `target` item, and the drop `zone`.
   * The function should return a boolean indicating whether the `selection` can be dropped there.
   *
   * The following checks are performed by default:
   *
   * - Items cannot be dropped in themselves.
   * - Parent items cannot be dropped inside their descendants.
   *
   * @default
   * false
   */
  droppable?:
    | boolean
    | ((
        selection: TreeItemModel<T>[],
        target: TreeItemModel<T>,
        zone: TreeDropTarget<T>['zone'],
      ) => boolean);

  /**
   * Specifies whether the tree item can be moved within the same level using keyboard shortcuts.
   * Only truthiness is checked, exactly as in the source: a function form is never invoked.
   * So passing a function means the item is always movable.
   *
   * @default
   * false
   */
  movable?: boolean | ((item: TreeItemModel<T>) => boolean);

  /**
   * Specifies whether the tree item can be selected.
   *
   * @default
   * true
   */
  selectable?: boolean;
} & (
  | {
      /**
       * Specifies whether the tree item can have children.
       */
      nestable: true;

      /**
       * The child tree items.
       */
      children?: TreeItemModel<T>[];

      /**
       * Indicates whether the tree item is expanded.
       */
      expanded?: boolean;
    }
  | {
      /**
       * Specifies whether the tree item can have children.
       */
      nestable: false;
    }
);

/**
 * A tree item projected into the flat list of currently visible rows.
 */
export interface TreeExtendedItemModel<T> {
  /**
   * The tree item model.
   */
  item: TreeItemModel<T>;

  /**
   * The index of the item in the `parent` or the root tree if `parents` is empty.
   */
  index: number;

  /**
   * All parents of the item, starting from the nearest parent.
   */
  parents: TreeExtendedParentItemModel<T>[];

  /**
   * All descendants of the item.
   */
  descendants: TreeExtendedItemModel<T>[];
}

/**
 * A projected tree item that is known to be nestable.
 */
export interface TreeExtendedParentItemModel<T> extends TreeExtendedItemModel<T> {
  /**
   * The tree item model.
   */
  item: TreeItemModel<T> & { nestable: true };
}

/**
 * A drop target within a tree.
 */
export interface TreeDropTarget<T> {
  /**
   * The tree item that is the drop target.
   */
  item: TreeItemModel<T>;

  /**
   * The drop zone relative to the drop target.
   */
  zone: 'before' | 'inside' | 'after';
}

/**
 * A source structure the `tree` component can mirror its mutations into.
 */
export interface TreeSource<Id extends string = string, Children extends string = string> {
  /**
   * The root-level source items.
   */
  root: TreeSourceItem<Id, Children>[];

  /**
   * The property names on source items that hold the identifier and the child items.
   */
  props: {
    /**
     * The property that holds the unique identifier of a source item.
     */
    id: Id;

    /**
     * The property that holds the child source items.
     */
    children: Children;
  };
}

/**
 * One item of a `TreeSource`.
 */
export type TreeSourceItem<Id extends string, Children extends string> = Record<
  Id,
  string | number
> &
  Partial<Record<Children, TreeSourceItem<Id, Children>[]>>;

/**
 * A function that generates a tree model from source data.
 */
export type TreeMapper<T> = (source: T[]) => TreeModel<T>;

/**
 * A managed tree model for use with the `tree` component.
 */
export interface Tree<T> {
  /**
   * The generated tree model ref to use in the `tree` component.
   * It contains the `source` data and the tree model.
   */
  tree: Ref<TreeModel<T>>;

  /**
   * Reinstantiates the tree model from the `source` data.
   */
  refresh: () => void;

  /**
   * Appends the specified `items` to the tree model under the specified `parent`.
   * If no `parent` is specified, the items are appended to the root of the tree model.
   */
  appendItems: (items: TreeItemModel<T>[], parent?: TreeItemModel<T>) => void;

  /**
   * Prepends the specified `items` to the tree model under the specified `parent`.
   * If no `parent` is specified, the items are prepended to the root of the tree model.
   */
  prependItems: (items: TreeItemModel<T>[], parent?: TreeItemModel<T>) => void;

  /**
   * Adds the specified `items` to the tree model before the specified `target` item.
   * Returns an array with the index and parent item of each added item, for mirroring onto a source array.
   */
  addItemsBefore: (
    items: TreeItemModel<T>[],
    target: TreeItemModel<T>,
  ) => { index: number; parent?: TreeItemModel<T> }[];

  /**
   * Adds the specified `items` to the tree model after the specified `target` item.
   * Returns an array with the index and parent item of each added item, for mirroring onto a source array.
   */
  addItemsAfter: (
    items: TreeItemModel<T>[],
    target: TreeItemModel<T>,
  ) => { index: number; parent?: TreeItemModel<T> }[];

  /**
   * Moves the specified `items` in the tree model in the specified `direction`.
   * Returns the moved tree items with their parent item, old index, and new index.
   */
  moveItems: (
    items: TreeItemModel<T>[],
    direction: 'up' | 'down',
  ) => { item: TreeItemModel<T>; parent?: TreeItemModel<T>; oldIndex: number; newIndex: number }[];

  /**
   * Drops the specified `items` before, inside, or after the `target` item.
   * Returns an array containing the dropped items, their new and old indexes, and the parent items.
   */
  dropItems: (
    items: TreeItemModel<T>[],
    target: TreeItemModel<T>,
    zone: TreeDropTarget<T>['zone'],
  ) => {
    item: TreeItemModel<T>;
    oldIndex: number;
    oldParent?: TreeItemModel<T>;
    newIndex: number;
    newParent?: TreeItemModel<T>;
  }[];

  /**
   * Removes `items` from the tree model.
   * Returns the deleted tree items with their parent item.
   */
  deleteItems: (
    items: TreeItemModel<T>[],
  ) => { item: TreeItemModel<T>; parent?: TreeItemModel<T> }[];
}

/**
 * Creates a managed tree model for use with the `tree` component.
 * The `mapper` generates the tree model from the `source` data.
 *
 * @example
 * ```ts
 * const { tree } = useTree(vdom, function map(nodes) {
 *   return nodes.map((node) => ({
 *     id: node.id,
 *     source: node,
 *     label: node.nodeName,
 *     nestable: true,
 *     children: map(node.children),
 *   }))
 * })
 * ```
 */
export function useTree<T>(source: T[], mapper: TreeMapper<T>): Tree<T> {
  const tree = ref(mapper(source));

  // ohne has no deep reactivity: the helpers mutate the model in place, so each one re-sets
  // `tree.value` to a shallow copy of the root array to notify dependents.
  const invalidate = (): void => {
    tree.value = [...tree.value];
  };

  return {
    tree,
    refresh: () => {
      tree.value = mapper(source);
    },
    appendItems: (items, parent?) => {
      if (parent?.nestable) {
        parent.children = parent.children ?? [];
        parent.children.push(...items);
      } else {
        tree.value.push(...items);
      }
      invalidate();
    },
    prependItems: (items, parent?) => {
      if (parent?.nestable) {
        parent.children = parent.children ?? [];
        parent.children.unshift(...items);
      } else {
        tree.value.unshift(...items);
      }
      invalidate();
    },
    addItemsBefore: (items, target) => {
      const added = addTreeItemsBefore(items, target, tree.value);
      invalidate();
      return added;
    },
    addItemsAfter: (items, target) => {
      const added = addTreeItemsAfter(items, target, tree.value);
      invalidate();
      return added;
    },
    moveItems: (items, direction) => {
      const moved = moveTreeItems(items, tree.value, direction);
      invalidate();
      return moved;
    },
    dropItems: (items, target, zone) => {
      const dropped = dropTreeItems(items, target, tree.value, zone);
      invalidate();
      return dropped;
    },
    deleteItems: (items) => {
      const deleted = deleteTreeItems(items, tree.value);
      invalidate();
      return deleted;
    },
  };
}

/**
 * Recursively flattens the tree `items`.
 * Children are included regardless of their `expanded` state.
 */
export function flatTreeItems<T>(items: TreeItemModel<T>[]): TreeItemModel<T>[] {
  const flattened: TreeItemModel<T>[] = [];

  for (const item of items) {
    flattened.push(item);

    if (item.nestable && item.children?.length) {
      flattened.push(...flatTreeItems(item.children));
    }
  }

  return flattened;
}

/**
 * Recursively flattens the tree `items` and includes the nesting `level` of each item.
 */
export function flatTreeItemsWithLevel<T>(
  items: TreeItemModel<T>[],
  level = 0,
): [item: TreeItemModel<T>, level: number][] {
  const flattened: [item: TreeItemModel<T>, level: number][] = [];

  for (const item of items) {
    flattened.push([item, level]);

    if (item.nestable && item.children?.length) {
      flattened.push(...flatTreeItemsWithLevel(item.children, level + 1));
    }
  }

  return flattened;
}

/**
 * Sorts the `items` in place based on their appearance in the tree.
 */
export function sortTreeItems<T>(
  items: TreeItemModel<T>[],
  tree: TreeModel<T>,
): TreeItemModel<T>[] {
  const flattened = flatTreeItems(tree);

  return items.sort((a, b) => {
    const aIndex = flattened.findIndex((item) => item.id === a.id);
    const bIndex = flattened.findIndex((item) => item.id === b.id);

    return aIndex - bIndex;
  });
}

/**
 * Retrieves the parent tree items for the specified `item`.
 * The resulting array is ordered from the root to the immediate parent.
 */
export function getParentTreeItems<T>(
  item: TreeItemModel<T>,
  tree: TreeModel<T>,
): TreeItemModel<T>[] {
  const parents: TreeItemModel<T>[] = [];
  const flattened = flatTreeItemsWithLevel(tree);
  const index = flattened.findIndex(([{ id }]) => id === item.id);

  let previous = item;

  for (let i = index - 1; i >= 0; i--) {
    const [current, level] = flattened[i]!;

    if (current.nestable && current.children?.some(({ id }) => id === previous.id)) {
      parents.unshift(current);
      previous = current;
    }

    if (level === 0) {
      break;
    }
  }

  return parents;
}

/**
 * Retrieves all child tree items for the specified `item`, including nested children.
 * The resulting array is ordered as items appear in the tree.
 */
export function getChildTreeItems<T>(
  item: TreeItemModel<T>,
  tree: TreeModel<T>,
): TreeItemModel<T>[] {
  const children: TreeItemModel<T>[] = [];
  const flattened = flatTreeItemsWithLevel(tree);
  const index = flattened.findIndex(([{ id }]) => id === item.id);
  const parentLevel = flattened[index]![1];

  for (let i = index + 1; i < flattened.length; i++) {
    const [current, level] = flattened[i]!;

    if (level > parentLevel) {
      children.push(current);
    } else {
      break;
    }
  }

  return children;
}

/**
 * Normalizes the tree selection by removing any child items that are also selected.
 * This function should be used before performing operations on the selected items.
 */
export function normalizeTreeSelection<T>(
  selection: TreeItemModel<T>[],
  tree: TreeModel<T>,
): TreeItemModel<T>[] {
  const deselect: (string | number)[] = [];

  for (const item of selection) {
    deselect.push(...getChildTreeItems(item, tree).map(({ id }) => id));
  }

  return uniqueById(selection).filter(({ id }) => !deselect.includes(id));
}

/**
 * Adds the specified `items` to the `tree` model before the `target` item.
 * Returns an array with the index and parent item of each added item.
 */
export function addTreeItemsBefore<T>(
  items: TreeItemModel<T>[],
  target: TreeItemModel<T>,
  tree: TreeModel<T>,
): { index: number; parent?: TreeItemModel<T> }[] {
  const parent = last(getParentTreeItems(target, tree));
  const slot = parent?.nestable ? parent.children! : tree;
  const index = slot.findIndex((item) => item.id === target.id);

  slot.splice(index, 0, ...items);

  return items.map((_, i) => ({ index: index + i, parent }));
}

/**
 * Adds the specified `items` to the `tree` model after the `target` item.
 * Returns an array with the index and parent item of each added item.
 */
export function addTreeItemsAfter<T>(
  items: TreeItemModel<T>[],
  target: TreeItemModel<T>,
  tree: TreeModel<T>,
): { index: number; parent?: TreeItemModel<T> }[] {
  const parent = last(getParentTreeItems(target, tree));
  const slot = parent?.nestable ? parent.children! : tree;
  const index = slot.findIndex((item) => item.id === target.id);

  slot.splice(index + 1, 0, ...items);

  return items.map((_, i) => ({ index: index + i + 1, parent }));
}

/**
 * Moves the specified `items` in the `tree` model in the specified `direction`.
 * Returns the moved tree items with their parent item, old index, and new index.
 *
 * The `min`/`max` ratchets compress a stacked selection at the edges without crossing.
 * They are shared across parent slots exactly as in the source.
 * So a selection spanning levels can be over-constrained.
 */
export function moveTreeItems<T>(
  items: TreeItemModel<T>[],
  tree: TreeModel<T>,
  direction: 'up' | 'down',
): { item: TreeItemModel<T>; parent?: TreeItemModel<T>; oldIndex: number; newIndex: number }[] {
  const moved: {
    item: TreeItemModel<T>;
    parent?: TreeItemModel<T>;
    oldIndex: number;
    newIndex: number;
  }[] = [];

  let min: number | undefined;
  let max: number | undefined;

  for (const item of direction === 'up' ? items : [...items].reverse()) {
    if (item.movable) {
      const parent = last(getParentTreeItems(item, tree));
      const slot = parent?.nestable ? parent.children! : tree;
      const oldIndex = slot.findIndex(({ id }) => id === item.id);
      const newIndex = clamp(
        oldIndex + (direction === 'up' ? -1 : 1),
        min ?? 0,
        max ?? slot.length - 1,
      );

      if (newIndex !== oldIndex) {
        slot.splice(oldIndex, 1);
        slot.splice(newIndex, 0, item);
      }

      if (direction === 'up' && (min === undefined || newIndex + 1 < min)) {
        min = newIndex + 1;
      } else if (direction === 'down' && (max === undefined || newIndex - 1 > max)) {
        max = newIndex - 1;
      }

      moved.push({ item, parent, oldIndex, newIndex });
    }
  }

  return moved;
}

/**
 * Drops the specified tree `items` before, inside, or after the `target` item.
 * Returns an array containing the dropped items, their new and old indexes, and the parent items.
 * Old indexes are pre-removal and new indexes are post-insertion.
 * So consumers replaying the change onto a source array must apply all removals first, then all insertions.
 */
export function dropTreeItems<T>(
  items: TreeItemModel<T>[],
  target: TreeItemModel<T>,
  tree: TreeModel<T>,
  zone: TreeDropTarget<T>['zone'],
): {
  item: TreeItemModel<T>;
  oldIndex: number;
  oldParent?: TreeItemModel<T>;
  newIndex: number;
  newParent?: TreeItemModel<T>;
}[] {
  const dropped: {
    item: TreeItemModel<T>;
    oldIndex: number;
    oldParent?: TreeItemModel<T>;
    newIndex: number;
    newParent?: TreeItemModel<T>;
  }[] = [];

  if (zone === 'inside') {
    const newParent = target as TreeItemModel<T> & { nestable: true };

    for (const item of items) {
      const oldParent = last(getParentTreeItems(item, tree));
      const oldSlot = oldParent?.nestable ? oldParent.children! : tree;
      const oldIndex = oldSlot.findIndex(({ id }) => id === item.id);

      dropped.push({ item, oldIndex, oldParent, newIndex: -1, newParent });
      oldSlot.splice(oldIndex, 1);
    }

    newParent.children = newParent.children ?? [];
    newParent.children.unshift(...items);

    for (let i = 0; i < items.length; i++) {
      dropped[i]!.newIndex = i;
      dropped[i]!.newParent = newParent;
    }
  } else {
    const newParent = last(getParentTreeItems(target, tree));
    const newSlot = newParent?.nestable ? newParent.children! : tree;

    let newIndex = newSlot.findIndex((item) => item.id === target.id) + (zone === 'after' ? 1 : 0);

    for (const item of items) {
      const oldParent = last(getParentTreeItems(item, tree));
      const oldSlot = oldParent?.nestable ? oldParent.children! : tree;
      const oldIndex = oldSlot.findIndex(({ id }) => id === item.id);

      dropped.push({ item, oldIndex, oldParent, newIndex: -1, newParent });
      oldSlot.splice(oldIndex, 1);

      if (oldSlot === newSlot && oldIndex < newIndex) {
        newIndex--;
      }
    }

    for (let i = 0; i < items.length; i++) {
      newSlot.splice(newIndex + i, 0, items[i]!);
      dropped[i]!.newIndex = newIndex + i;
    }
  }

  return dropped;
}

/**
 * Deletes the specified `items` from the `tree` model.
 * Returns the deleted tree items with their parent item.
 */
export function deleteTreeItems<T>(
  items: TreeItemModel<T>[],
  tree: TreeModel<T>,
): { item: TreeItemModel<T>; parent?: TreeItemModel<T> }[] {
  const deleted: { item: TreeItemModel<T>; parent?: TreeItemModel<T> }[] = [];

  for (const item of items) {
    const parent = last(getParentTreeItems(item, tree));
    const slot = parent?.nestable ? parent.children! : tree;

    let index: number;
    do {
      index = slot.findIndex(({ id }) => id === item.id);
      if (index !== -1) slot.splice(index, 1);
    } while (index !== -1);

    deleted.push({ item, parent });
  }

  return deleted;
}

/**
 * Retrieves the currently visible tree items, sorted by their UI appearance.
 * Children are traversed only for nestable, expanded items that have any.
 * Each row carries its index within its parent slot, its parents nearest-first, and its visible descendants.
 */
export function activeTreeItems<T>(
  tree: TreeModel<T>,
  parents: TreeExtendedParentItemModel<T>[] = [],
): TreeExtendedItemModel<T>[] {
  const items: TreeExtendedItemModel<T>[] = [];

  for (const [index, item] of tree.entries()) {
    const current: TreeExtendedItemModel<T> = { item, index, parents, descendants: [] };
    const previousLength = items.length;

    items.push(current);

    if (item.nestable && item.expanded && item.children?.length) {
      items.push(
        ...activeTreeItems(item.children, [current as TreeExtendedParentItemModel<T>, ...parents]),
      );
    }

    current.descendants = items.slice(previousLength + 1);
  }

  return items;
}

/**
 * Clones a tree item, including all child items, and assigns new random identifiers.
 * Functions on the item are kept by reference; everything else is deep-cloned.
 * When `sourceIdProp` is given, each clone's identifier is also written to its source item.
 */
export function cloneTreeItem<T>(item: TreeItemModel<T>, sourceIdProp?: string): TreeItemModel<T> {
  const clone = deepCloneValue(item);
  randomizeIds(clone, sourceIdProp);
  return clone;
}

function randomizeIds<T>(item: TreeItemModel<T>, sourceIdProp?: string): void {
  item.id = randomAlphabetic(23);

  if (sourceIdProp) {
    (item.source as Record<string, unknown>)[sourceIdProp] = item.id;
  }

  if (item.nestable && item.children?.length) {
    for (const child of item.children) {
      randomizeIds(child, sourceIdProp);
    }
  }
}

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

function randomAlphabetic(length: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let id = '';
  for (const byte of bytes) id += alphabet[byte % alphabet.length];
  return id;
}

function deepCloneValue<T>(value: T): T {
  if (value === null || typeof value !== 'object') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => deepCloneValue(item)) as T;
  }

  const clone: Record<PropertyKey, unknown> = {};

  for (const key of Object.getOwnPropertyNames(value)) {
    clone[key] = deepCloneValue((value as Record<string, unknown>)[key]);
  }

  for (const symbol of Object.getOwnPropertySymbols(value)) {
    clone[symbol] = deepCloneValue((value as Record<symbol, unknown>)[symbol]);
  }

  return clone as T;
}

function uniqueById<T>(items: TreeItemModel<T>[]): TreeItemModel<T>[] {
  return items.filter((item, index) => items.findIndex(({ id }) => id === item.id) === index);
}
