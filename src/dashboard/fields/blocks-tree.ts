import type { TreeItemModel, TreeModel } from '../ui/tree-model.ts';
import type { BlockNode, BlocksHandle } from './builtin/blocks.ts';

import { isNull } from '../../utils/is/is-null.ts';
import { isNumber } from '../../utils/is/is-number.ts';
import { isString } from '../../utils/is/is-string.ts';
import { isUndefined } from '../../utils/is/is-undefined.ts';
import { omit } from '../../utils/object/omit.ts';
import { onCleanup } from '../../utils/reactive/effect-scope.ts';
import { effect } from '../../utils/reactive/effect.ts';
import { nextTick } from '../../utils/reactive/next-tick.ts';
import { ref } from '../../utils/reactive/ref.ts';
import { untracked } from '../../utils/reactive/untracked.ts';
import { css } from '../render/css.ts';
import { h } from '../render/h.ts';
import { when } from '../render/when.ts';
import { useT } from '../runtime/use-t.ts';
import { bubble } from '../ui/bubble.ts';
import { button } from '../ui/button.ts';
import { dropdownItem } from '../ui/dropdown-item.ts';
import { dropdown } from '../ui/dropdown.ts';
import { useHotkeys } from '../ui/hotkeys.ts';
import { icon } from '../ui/icon.ts';
import { toast } from '../ui/toaster.ts';
import { attachTooltip } from '../ui/tooltip.ts';
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
import { openBlockPicker } from './block-picker-popup.ts';
import { blocksHandleOf } from './builtin/blocks.ts';
import { clipboardData, copyClipboard } from './clipboard.ts';

/**
 * One row of the blocks tree.
 */
export type BlocksTreeRow = BlockTreeRow<BlockNode>;

/**
 * An action a blocks tree runs on blocks: the row menu's, and its keys'.
 */
export type BlockAction =
  | 'moveUp'
  | 'moveDown'
  | 'addBefore'
  | 'addInside'
  | 'addAfter'
  | 'duplicate'
  | 'delete'
  | 'copy'
  | 'cut'
  | 'paste';

/**
 * Where an added or pasted block lands: a list and the index in its current nodes.
 */
interface Destination {
  list: BlocksHandle;
  index: number;
}

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
   * The block the pointer or the keyboard rests on, or `undefined`.
   * Reactive.
   */
  highlighted(): BlockNode | undefined;

  /**
   * The blocks from the root down to `node`, `node` included; empty when the tree does not hold it.
   */
  pathTo(node: BlockNode): BlockNode[];

  /**
   * Adds a block at the end of the root list, through the block picker when the list admits several types.
   */
  addTopLevel(): void;

  /**
   * Runs `action` on the blocks with these `$key`s, as the row menu and the keys do.
   * Adding opens the block picker when the target list admits several types; pasting lands after the blocks.
   * A locked list runs nothing but `copy`.
   */
  run(action: BlockAction, keys: readonly number[]): void;
}

css`
  .ohne-blocks-tree {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .ohne-blocks-tree > .ohne-tree {
    flex: 1;
    min-height: 0;
  }

  .ohne-blocks-tree-empty {
    display: flex;
    justify-content: center;
    align-items: center;
    height: 100%;
    color: hsl(var(--ohne-muted-foreground));
    font-size: 0.875rem;
  }

  .ohne-blocks-tree .ohne-tree-item-label {
    flex: 1;
    min-width: 0;
  }

  .ohne-blocks-tree-item {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    width: 100%;
    min-width: 0;
  }

  .ohne-blocks-tree-slot {
    color: hsl(var(--ohne-muted-foreground));
    font-size: calc(1em - 0.1875rem);
    font-weight: 600;
    text-transform: uppercase;
  }

  .ohne-blocks-tree-actions {
    display: flex;
    flex-shrink: 0;
    gap: 0.125rem;
    margin-left: auto;
    visibility: hidden;
  }

  .ohne-tree-item:hover .ohne-blocks-tree-actions,
  .ohne-tree-item-button-highlighted .ohne-blocks-tree-actions,
  .ohne-blocks-tree-actions-open {
    visibility: visible;
  }
`;

/**
 * A tree over one `blocks` list and every list nested in its blocks.
 * Every change runs through the lists' own handles, so the form, its history, and its dirt follow.
 * Drag and drop and the move, duplicate, delete, copy, and cut keys come from `tree`.
 * Enter adds after the selection and Shift+Enter before it; Escape clears it; Cmd/Ctrl+V pastes after it.
 * A row offers `+` to add inside it and a menu that adds, copies, cuts, pastes, duplicates, and deletes.
 * A block that holds several `blocks` fields shows one slot row per field; slots take drops but no selection.
 * A locked list renders the rows with no actions.
 */
export function blocksTree(list: () => BlocksHandle | undefined): BlocksTree {
  const t = useT();
  const model = ref<TreeModel<BlocksTreeRow>>([]);
  const selectedItems = ref<TreeItemModel<BlocksTreeRow>[]>([]);
  const highlightedItem = ref<TreeItemModel<BlocksTreeRow> | undefined>(undefined);
  const menuOpen = ref<number | undefined>(undefined);
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
    const kept = new Set(untracked(() => selectedItems.value).map((item) => item.id));
    selectedItems.value = flatTreeItems(untracked(() => model.value)).filter((item) =>
      kept.has(item.id),
    );
  });

  const editable = (): boolean => list()?.disabled === false;

  const blockRows = (
    items: readonly TreeItemModel<BlocksTreeRow>[],
  ): { node: BlockNode; list: BlocksHandle }[] =>
    items.flatMap(({ source }) =>
      source.kind === 'block' ? [{ node: source.node, list: source.list as BlocksHandle }] : [],
    );

  const byList = (
    items: readonly TreeItemModel<BlocksTreeRow>[],
  ): Map<BlocksHandle, Set<object>> => {
    const grouped = new Map<BlocksHandle, Set<object>>();
    for (const { node, list: from } of blockRows(items)) {
      const forms = grouped.get(from) ?? new Set<object>();
      forms.add(node.form);
      grouped.set(from, forms);
    }
    return grouped;
  };

  const itemOf = (node: BlockNode): TreeItemModel<BlocksTreeRow> | undefined =>
    flatTreeItems(model.value).find((item) => item.id === node.$key);

  const select = (keys: readonly number[]): void => {
    queueMicrotask(() => {
      const items = flatTreeItems(model.value).filter((item) => keys.includes(item.id as number));
      selectedItems.value = items;
      const first = items[0];
      if (!isUndefined(first)) handle?.scrollToItem(first);
    });
  };

  const insert = (destination: Destination, nodes: BlockNode[]): void => {
    if (nodes.length === 0) return;
    const current = destination.list.nodes();
    destination.list.commit([
      ...current.slice(0, destination.index),
      ...nodes,
      ...current.slice(destination.index),
    ]);
    select(nodes.map((node) => node.$key));
  };

  const add = (destination: Destination | undefined): void => {
    if (isUndefined(destination) || destination.list.disabled) return;
    const { offered } = destination.list;
    const place = (name: string): void => {
      const node = destination.list.create(name);
      insert(destination, [node]);
      setTimeout(() => node.form.focus());
    };
    if (offered.length === 1) place(offered[0] as string);
    else if (offered.length > 1) {
      void openBlockPicker(offered).then((name) => {
        if (!isNull(name)) place(name);
      });
    }
  };

  const paste = (destination: Destination | undefined): void => {
    const payload = clipboardData.value;
    if (isUndefined(destination) || isNull(payload) || payload.ohneClipboardDataType !== 'blocks')
      return;
    const fits = payload.data.filter(({ $key }) => destination.list.offered.includes($key));
    insert(
      destination,
      fits.map((item) => destination.list.create(item.$key, omit(item, ['$key']))),
    );
    const refused = payload.data.length - fits.length;
    if (refused > 0)
      toast(t('dashboard.blocks.notPasted', { count: refused }), { type: 'warning' });
  };

  const remove = (items: readonly TreeItemModel<BlocksTreeRow>[]): void => {
    for (const [from, forms] of byList(items)) {
      from.commit(from.nodes().filter((node) => !forms.has(node.form)));
    }
    selectedItems.value = [];
  };

  const copy = (items: readonly TreeItemModel<BlocksTreeRow>[]): void => {
    const data = blockRows(items).map(({ node, list: from }) => ({
      $key: node.block,
      ...from.copy(node),
    }));
    if (data.length === 0) return;
    copyClipboard({ ohneClipboardDataType: 'blocks', data });
    toast(t('dashboard.clipboard.copied'), { type: 'success' });
  };

  const duplicate = (items: readonly TreeItemModel<BlocksTreeRow>[]): void => {
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
  };

  const step = (items: readonly TreeItemModel<BlocksTreeRow>[], delta: -1 | 1): void => {
    for (const [from, forms] of byList(items)) from.commit(stepBlocks(from.nodes(), forms, delta));
    select(blockRows(items).map(({ node }) => node.$key));
  };

  const beside = (
    item: TreeItemModel<BlocksTreeRow> | undefined,
    zone: 'before' | 'inside' | 'after',
  ): Destination | undefined => {
    const destination = isUndefined(item) ? undefined : dropDestination(item, zone, slots);
    return isUndefined(destination)
      ? undefined
      : { list: destination.list as BlocksHandle, index: destination.index };
  };

  const element = tree<BlocksTreeRow>({
    model,
    selectedItems,
    highlightedItem,
    itemIcon: (item) => icon(rowIcon(item.source)),
    itemLabel: (item) => rowLabel(item),
    onDropItems: (items, target, zone) => {
      const destination = dropDestination(target, zone, slots);
      if (isUndefined(destination)) return;
      select(placeBlocks(destination, blockRows(items)).map((node) => node.$key));
    },
    onDeleteItems: (items) => {
      if (editable()) remove(items);
    },
    onCutItems: (items) => {
      if (!editable()) return;
      copy(items);
      remove(items);
    },
    onCopyItems: copy,
    onDuplicateItems: (items) => {
      if (editable()) duplicate(items);
    },
    onMoveUpItems: (items) => {
      if (editable()) step(items, -1);
    },
    onMoveDownItems: (items) => {
      if (editable()) step(items, 1);
    },
    expose: (exposed) => {
      handle = exposed;
    },
  });

  const hotkeys = useHotkeys();
  const stops: (() => void)[] = [];
  effect(() => {
    for (const stop of stops.splice(0)) stop();
    if (handle?.focused.value !== true) return;
    const selection = selectedItems.value;
    const last = selection[selection.length - 1];
    stops.push(
      hotkeys.listen('close', (event) => {
        if (selection.length === 0) return;
        event.preventDefault();
        selectedItems.value = [];
      }),
      hotkeys.listen('selectAll', (event) => {
        event.preventDefault();
        selectedItems.value = flatTreeItems(model.value).filter(
          (item) => item.selectable !== false,
        );
      }),
    );
    if (!editable() || isUndefined(last)) return;
    stops.push(
      hotkeys.listen('insertAfter', (event) => {
        event.preventDefault();
        add(beside(last, 'after'));
      }),
      hotkeys.listen('insertBefore', (event) => {
        event.preventDefault();
        add(beside(selection[0], 'before'));
      }),
      hotkeys.listen('paste', (event) => {
        event.preventDefault();
        paste(beside(last, 'after'));
      }),
    );
  });
  onCleanup(() => {
    for (const stop of stops.splice(0)) stop();
  });

  /**
   * The label of a row: the block label with its title field's value, error bubbles, and the actions.
   */
  function rowLabel(item: TreeItemModel<BlocksTreeRow>): HTMLElement {
    const row = item.source;
    if (row.kind === 'slot') {
      return h(
        'span',
        { class: 'ohne-blocks-tree-item' },
        h('span', { class: 'ohne-blocks-tree-slot ohne-truncate' }, row.label),
        editable() ? h('span', { class: 'ohne-blocks-tree-actions' }, plusButton(item)) : null,
      );
    }
    const block = blockNamed(blocksOf(), row.node.block);
    const label = (): string => {
      const field = block?.titleField;
      const value = isUndefined(field) ? undefined : valueOf(row.node, field);
      const name = block?.label ?? row.node.block;
      return isUndefined(value) || value === '' ? name : `${name} (${value})`;
    };
    const errored = h('span', { class: 'ohne-shrink-0' }, () =>
      row.node.own.value !== '' || row.node.form.errored()
        ? bubble('!', { variant: 'destructive' })
        : null,
    );
    return h(
      'span',
      { class: 'ohne-blocks-tree-item' },
      h('span', { class: 'ohne-truncate', title: label }, label),
      errored,
      editable() ? rowActions(item) : null,
    );
  }

  /**
   * The `+` that adds a block at the end of the row's one nested list, or nothing when it holds none or several.
   */
  function plusButton(item: TreeItemModel<BlocksTreeRow>): HTMLElement | null {
    const destination = beside(item, 'inside');
    if (isUndefined(destination) || destination.list.offered.length === 0) return null;
    const plus = button(icon('plus'), {
      size: -3,
      variant: 'ghost',
      onClick: (event) => {
        event.stopPropagation();
        add({ list: destination.list, index: destination.list.nodes().length });
      },
    });
    plus.tabIndex = -1;
    onCleanup(attachTooltip(plus, () => t('dashboard.blocks.addNested')));
    return plus;
  }

  /**
   * The row's `+` and its actions menu, shown while the row is hovered or highlighted, or the menu is open.
   */
  function rowActions(item: TreeItemModel<BlocksTreeRow>): HTMLElement {
    const key = item.id as number;
    const dots = button(icon('dots'), {
      size: -3,
      variant: 'ghost',
      onClick: () => {
        menuOpen.value = menuOpen.value === key ? undefined : key;
      },
    });
    dots.tabIndex = -1;
    effect(() => {
      dots.title = t('dashboard.record.moreActions');
      dots.classList.toggle('ohne-button-ghost', menuOpen.value !== key);
      dots.classList.toggle('ohne-button-primary', menuOpen.value === key);
    });
    return h(
      'span',
      {
        class: () =>
          'ohne-blocks-tree-actions' +
          (menuOpen.value === key ? ' ohne-blocks-tree-actions-open' : ''),
        onClick: (event: MouseEvent) => {
          if (selectedItems.value.length > 1) event.stopPropagation();
        },
      },
      plusButton(item),
      dots,
      when(
        () => menuOpen.value === key,
        () => rowMenu(item, dots),
      ),
    );
  }

  /**
   * The actions menu of a row, acting on the selection when the row is in it, else on the row alone.
   */
  function rowMenu(item: TreeItemModel<BlocksTreeRow>, reference: HTMLElement): HTMLElement {
    const close = (): void => {
      menuOpen.value = undefined;
    };
    const selection = untracked(() => selectedItems.value);
    const targets = selection.some((entry) => entry.id === item.id) ? selection : [item];
    const single = targets.length === 1;
    const canPaste = (): boolean => {
      const payload = clipboardData.value;
      return !isNull(payload) && payload.ohneClipboardDataType === 'blocks';
    };
    const action = (
      shape: Parameters<typeof icon>[0],
      label: () => string,
      run: () => void,
      destructive = false,
    ): HTMLElement => {
      const el = dropdownItem([icon(shape), h('span', null, label)], {
        destructive,
        onClick: () => {
          close();
          void nextTick().then(run);
        },
      });
      effect(() => {
        el.title = label();
      });
      return el;
    };
    const inside = beside(item, 'inside');
    const menu = dropdown(
      [
        single
          ? [
              action(
                'arrow-bar-to-up',
                () => t('dashboard.sort.addBefore'),
                () => add(beside(item, 'before')),
              ),
              isUndefined(inside)
                ? null
                : action(
                    'circle-plus',
                    () => t('dashboard.sort.addInside'),
                    () => add({ list: inside.list, index: inside.list.nodes().length }),
                  ),
              action(
                'arrow-bar-to-down',
                () => t('dashboard.sort.addAfter'),
                () => add(beside(item, 'after')),
              ),
              h('hr'),
            ]
          : null,
        action(
          'clipboard',
          () => t('dashboard.clipboard.copy'),
          () => copy(targets),
        ),
        action(
          'cut',
          () => t('dashboard.clipboard.cut'),
          () => {
            copy(targets);
            remove(targets);
          },
        ),
        when(
          () => single && canPaste(),
          () => [
            action(
              'clipboard-plus',
              () => t('dashboard.clipboard.pasteBefore'),
              () => paste(beside(item, 'before')),
            ),
            isUndefined(inside)
              ? null
              : action(
                  'clipboard-plus',
                  () => t('dashboard.clipboard.pasteInside'),
                  () => paste({ list: inside.list, index: inside.list.nodes().length }),
                ),
            action(
              'clipboard-plus',
              () => t('dashboard.clipboard.pasteAfter'),
              () => paste(beside(item, 'after')),
            ),
          ],
        ),
        h('hr'),
        action(
          'copy',
          () => t('dashboard.duplicate'),
          () => duplicate(targets),
        ),
        action(
          'trash',
          () => t('dashboard.delete'),
          () => remove(targets),
          true,
        ),
      ],
      { reference, placement: 'end', onClose: close },
    );
    return menu.root;
  }

  return {
    element: h(
      'div',
      { class: 'ohne-blocks-tree' },
      when(
        () => model.value.length === 0,
        () => h('div', { class: 'ohne-blocks-tree-empty' }, () => t('dashboard.blocks.empty')),
        () => element,
      ),
    ),
    selected: () => blockRows(selectedItems.value).map(({ node }) => node),
    select,
    highlighted: () => {
      const source = highlightedItem.value?.source;
      return source?.kind === 'block' ? source.node : undefined;
    },
    pathTo(node) {
      const item = itemOf(node);
      if (isUndefined(item)) return [];
      const path: BlockNode[] = [];
      const walk = (items: TreeModel<BlocksTreeRow>, trail: BlockNode[]): boolean => {
        for (const entry of items) {
          const next = entry.source.kind === 'block' ? [...trail, entry.source.node] : trail;
          if (entry.id === item.id) {
            path.push(...next);
            return true;
          }
          if (entry.nestable && walk(entry.children ?? [], next)) return true;
        }
        return false;
      };
      walk(model.value, []);
      return path;
    },
    addTopLevel() {
      const root = list();
      if (!isUndefined(root)) add({ list: root, index: root.nodes().length });
    },
    run(action, keys) {
      const items = flatTreeItems(model.value).filter((item) => keys.includes(item.id as number));
      const first = items[0];
      const last = items[items.length - 1];
      if (isUndefined(first) || isUndefined(last)) return;
      if (action === 'copy') copy(items);
      if (!editable()) return;
      if (action === 'moveUp') step(items, -1);
      else if (action === 'moveDown') step(items, 1);
      else if (action === 'addBefore') add(beside(first, 'before'));
      else if (action === 'addAfter') add(beside(last, 'after'));
      else if (action === 'addInside') {
        const inside = beside(first, 'inside');
        if (!isUndefined(inside)) add({ list: inside.list, index: inside.list.nodes().length });
      } else if (action === 'duplicate') duplicate(items);
      else if (action === 'delete') remove(items);
      else if (action === 'cut') {
        copy(items);
        remove(items);
      } else if (action === 'paste') paste(beside(last, 'after'));
    },
  };
}

/**
 * The icon of a row: the block's own, picked live from its fields, or a stack for a slot.
 */
function rowIcon(row: BlocksTreeRow): Parameters<typeof icon>[0] {
  if (row.kind === 'slot') return 'stack';
  const block = blockNamed(blocksOf(), row.node.block);
  const field = block?.icon;
  if (isUndefined(field) || isString(field)) return blockIcon(block);
  return blockIcon(block, { [field.field]: valueOf(row.node, field.field) });
}

/**
 * A block field's live value as text, or `undefined` when it is not a plain string or number.
 */
function valueOf(node: BlockNode, field: string): string | undefined {
  const value = node.form.controlOf(field)?.read().value;
  if (isString(value)) return value;
  return isNumber(value) ? String(value) : undefined;
}
