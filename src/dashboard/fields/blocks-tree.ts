import type { TreeItemModel, TreeModel } from '../ui/tree-model.ts';
import type { BlockNode, BlocksHandle } from './builtin/blocks.ts';

import { isNumber } from '../../utils/is/is-number.ts';
import { isString } from '../../utils/is/is-string.ts';
import { isUndefined } from '../../utils/is/is-undefined.ts';
import { effect } from '../../utils/reactive/effect.ts';
import { ref } from '../../utils/reactive/ref.ts';
import { untracked } from '../../utils/reactive/untracked.ts';
import { css } from '../render/css.ts';
import { h } from '../render/h.ts';
import { icon } from '../ui/icon.ts';
import { flatTreeItems } from '../ui/tree-model.ts';
import { tree, type TreeHandle } from '../ui/tree.ts';
import {
  type BlockSlots,
  type BlockTreeRow,
  blockTreeModel,
  dropDestination,
  placeBlocks,
  stepBlocks,
} from './_block-tree.ts';
import { blockIcon, blocksOf } from './_blocks.ts';
import { blockNamed } from './_items.ts';
import { blocksHandleOf } from './builtin/blocks.ts';
import { copyClipboard } from './clipboard.ts';

/**
 * One row of the blocks tree.
 */
export type BlocksTreeRow = BlockTreeRow<BlockNode>;

/**
 * The live surface of a blocks tree.
 */
export interface BlocksTree {
  /**
   * The tree element.
   */
  element: HTMLElement;

  /**
   * The selected blocks, in tree order.
   * Reactive.
   */
  selected(): BlockNode[];

  /**
   * Selects the blocks with these `$key`s and scrolls the first into view.
   */
  select(keys: readonly number[]): void;

  /**
   * The block the pointer rests on, or `undefined`.
   * Reactive.
   */
  highlighted(): BlockNode | undefined;
}

css`
  .ohne-blocks-tree-title {
    margin-left: 0.375em;
    color: hsl(var(--ohne-muted-foreground));
  }

  .ohne-blocks-tree-error {
    flex-shrink: 0;
    margin-left: auto;
    padding-left: 0.375em;
    color: hsl(var(--ohne-destructive));
  }
`;

/**
 * A tree over one `blocks` list and every list nested in its blocks.
 * Every change runs through the lists' own handles, so the form, its history, and its dirt follow.
 * Drag and drop, the move, duplicate, delete, copy, and cut keys come from `tree`.
 * A block that holds several `blocks` fields shows one slot row per field; slots take drops but no selection.
 */
export function blocksTree(list: () => BlocksHandle | undefined): BlocksTree {
  const model = ref<TreeModel<BlocksTreeRow>>([]);
  const selectedItems = ref<TreeItemModel<BlocksTreeRow>[]>([]);
  const highlightedItem = ref<TreeItemModel<BlocksTreeRow> | undefined>(undefined);
  let handle: TreeHandle<BlocksTreeRow> | undefined;

  const slots: BlockSlots<BlockNode> = (node) =>
    (blockNamed(blocksOf(), node.block)?.fields ?? []).flatMap((field) => {
      const nested =
        field.type === 'blocks' ? blocksHandleOf(node.form.controlOf(field.name)) : undefined;
      return isUndefined(nested) ? [] : [{ name: field.name, label: field.label, list: nested }];
    });

  effect(() => {
    const root = list();
    const folded = new Set(
      flatTreeItems(untracked(() => model.value))
        .filter((item) => item.nestable && item.expanded === false)
        .map((item) => item.id),
    );
    model.value = isUndefined(root) ? [] : blockTreeModel(root, slots, (id) => folded.has(id));
    const live = new Set(flatTreeItems(model.value).map((item) => item.id));
    const kept = untracked(() => selectedItems.value).filter((item) => live.has(item.id));
    selectedItems.value = flatTreeItems(model.value).filter((item) =>
      kept.some((entry) => entry.id === item.id),
    );
  });

  const blockRows = (
    items: TreeItemModel<BlocksTreeRow>[],
  ): { node: BlockNode; list: BlocksHandle }[] =>
    items.flatMap(({ source }) =>
      source.kind === 'block' ? [{ node: source.node, list: source.list as BlocksHandle }] : [],
    );

  const byList = (items: TreeItemModel<BlocksTreeRow>[]): Map<BlocksHandle, Set<object>> => {
    const grouped = new Map<BlocksHandle, Set<object>>();
    for (const { node, list: from } of blockRows(items)) {
      const forms = grouped.get(from) ?? new Set<object>();
      forms.add(node.form);
      grouped.set(from, forms);
    }
    return grouped;
  };

  const select = (keys: readonly number[]): void => {
    queueMicrotask(() => {
      const items = flatTreeItems(model.value).filter((item) => keys.includes(item.id as number));
      selectedItems.value = items;
      const first = items[0];
      if (!isUndefined(first)) handle?.scrollToItem(first);
    });
  };

  const remove = (items: TreeItemModel<BlocksTreeRow>[]): void => {
    for (const [from, forms] of byList(items)) {
      from.commit(from.nodes().filter((node) => !forms.has(node.form)));
    }
    selectedItems.value = [];
  };

  const copy = (items: TreeItemModel<BlocksTreeRow>[]): void => {
    const data = blockRows(items).map(({ node, list: from }) => ({
      $key: node.block,
      ...from.copy(node),
    }));
    if (data.length > 0) copyClipboard({ ohneClipboardDataType: 'blocks', data });
  };

  const step = (items: TreeItemModel<BlocksTreeRow>[], delta: -1 | 1): void => {
    for (const [from, forms] of byList(items)) from.commit(stepBlocks(from.nodes(), forms, delta));
    select(blockRows(items).map(({ node }) => node.$key));
  };

  const element = tree<BlocksTreeRow>({
    model,
    selectedItems,
    highlightedItem,
    itemIcon: (item) => icon(rowIcon(item.source)),
    itemLabel: (item) => rowLabel(item.source),
    onDropItems: (items, target, zone) => {
      const destination = dropDestination(target, zone, slots);
      if (isUndefined(destination)) return;
      const placed = placeBlocks(destination, blockRows(items));
      select(placed.map((node) => node.$key));
    },
    onDeleteItems: remove,
    onCutItems: (items) => {
      copy(items);
      remove(items);
    },
    onCopyItems: copy,
    onDuplicateItems: (items) => {
      const created: number[] = [];
      for (const [from, forms] of byList(items)) {
        const next = from.nodes().flatMap((node) => {
          if (!forms.has(node.form)) return [node];
          const twin = from.create(node.block, from.copy(node));
          created.push(twin.$key);
          return [node, twin];
        });
        from.commit(next);
      }
      select(created);
    },
    onMoveUpItems: (items) => step(items, -1),
    onMoveDownItems: (items) => step(items, 1),
    expose: (exposed) => {
      handle = exposed;
    },
  });

  return {
    element,
    selected: () => blockRows(selectedItems.value).map(({ node }) => node),
    select,
    highlighted: () => {
      const source = highlightedItem.value?.source;
      return source?.kind === 'block' ? source.node : undefined;
    },
  };
}

/**
 * The icon of a row: the block's own, picked live from its fields, or a stack for a slot.
 */
function rowIcon(row: BlocksTreeRow): Parameters<typeof icon>[0] {
  if (row.kind === 'slot') return 'stack-2';
  const block = blockNamed(blocksOf(), row.node.block);
  const field = block?.icon;
  if (isUndefined(field) || isString(field)) return blockIcon(block);
  return blockIcon(block, { [field.field]: valueOf(row.node, field.field) });
}

/**
 * The label of a row: the block label, its title field's value dimmed beside it, and an error mark.
 */
function rowLabel(row: BlocksTreeRow): HTMLElement {
  if (row.kind === 'slot') return h('span', null, row.label);
  const block = blockNamed(blocksOf(), row.node.block);
  return h(
    'span',
    { class: 'ohne-row ohne-w-full' },
    h('span', { class: 'ohne-truncate' }, block?.label ?? row.node.block, () => {
      const field = block?.titleField;
      const value = isUndefined(field) ? undefined : valueOf(row.node, field);
      return isUndefined(value) || value === ''
        ? null
        : h('span', { class: 'ohne-blocks-tree-title' }, value);
    }),
    () =>
      row.node.own.value !== '' || row.node.form.errored()
        ? h('span', { class: 'ohne-blocks-tree-error' }, icon('alert-circle'))
        : null,
  );
}

/**
 * A block field's live value as text, or `undefined` when it is not a plain string or number.
 */
function valueOf(node: BlockNode, field: string): string | undefined {
  const value = node.form.controlOf(field)?.read().value;
  if (isString(value)) return value;
  return isNumber(value) ? String(value) : undefined;
}
