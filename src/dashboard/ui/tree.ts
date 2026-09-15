import type { ComputedRef } from '../../utils/reactive/computed.ts';
import type { Child } from '../render/insert.ts';

import { next } from '../../utils/array/next.ts';
import { prev } from '../../utils/array/prev.ts';
import { isUndefined } from '../../utils/is/is-undefined.ts';
import { computed } from '../../utils/reactive/computed.ts';
import { onCleanup } from '../../utils/reactive/effect-scope.ts';
import { effect } from '../../utils/reactive/effect.ts';
import { nextTick } from '../../utils/reactive/next-tick.ts';
import { type Ref, ref } from '../../utils/reactive/ref.ts';
import { untracked } from '../../utils/reactive/untracked.ts';
import { css } from '../render/css.ts';
import { each } from '../render/each.ts';
import { h } from '../render/h.ts';
import { useHotkeys } from './hotkeys.ts';
import { listenClickOutside } from './overlay.ts';
import { type ScrollableHandle, scrollable } from './scrollable.ts';
import { treeItem } from './tree-item.ts';
import {
  activeTreeItems,
  addTreeItemsBefore,
  cloneTreeItem,
  deleteTreeItems,
  dropTreeItems,
  flatTreeItems,
  moveTreeItems,
  normalizeTreeSelection,
  sortTreeItems,
  type TreeDropTarget,
  type TreeExtendedItemModel,
  type TreeItemModel,
  type TreeModel,
  type TreeSource,
} from './tree-model.ts';
import './tokens.ts';

/**
 * The sizes `tree` derives from the live computed styles, in pixels.
 */
export interface TreeItemSizes {
  /**
   * The document's base font size.
   */
  baseFontSize: number;

  /**
   * One `em` at the tree's own size.
   */
  em: number;

  /**
   * The height of a single tree row, matching the CSS row height `calc(2em + 0.25rem)`.
   */
  itemHeight: number;
}

/**
 * The live surface a `tree` exposes to its caller.
 */
export interface TreeHandle<T> {
  /**
   * The currently visible tree items, sorted by their UI appearance.
   */
  activeItems: ComputedRef<TreeExtendedItemModel<T>[]>;

  /**
   * The selected tree items as an object with the item ids as keys.
   */
  selectedItemIds: ComputedRef<Record<string, boolean>>;

  /**
   * Whether focus currently sits inside the tree.
   */
  focused: Ref<boolean>;

  /**
   * Returns the flat list of all items in the tree.
   */
  flatItems: () => TreeItemModel<T>[];

  /**
   * Deletes the specified tree `items`, mirroring into `source` when set.
   */
  deleteItems: (items: TreeItemModel<T>[], event: Event) => void;

  /**
   * Drops the specified `items` on the `target` item, mirroring into `source` when set.
   */
  dropItems: (
    items: TreeItemModel<T>[],
    target: TreeItemModel<T>,
    zone: TreeDropTarget<T>['zone'],
  ) => void;

  /**
   * Duplicates the specified tree `items`, mirroring into `source` when set.
   */
  duplicateItems: (items: TreeItemModel<T>[], event: Event) => void;

  /**
   * Moves the specified tree `items` down, mirroring into `source` when set.
   */
  moveDownItems: (items: TreeItemModel<T>[], event: Event) => void;

  /**
   * Moves the specified tree `items` up, mirroring into `source` when set.
   */
  moveUpItems: (items: TreeItemModel<T>[], event: Event) => void;

  /**
   * Scrolls to the specified `item` in the tree.
   */
  scrollToItem: (item: TreeItemModel<T>) => void;

  /**
   * Scrolls to the first selected tree item.
   */
  scrollToSelection: () => void;

  /**
   * The handle of the inner scroll container.
   */
  scrollable: ScrollableHandle;

  /**
   * Recomputes the virtualization window for the scroll offset `y`.
   */
  updatePlaceholder: (y: number) => void;

  /**
   * Calculates the base font size, em unit, and the height of an item in the tree.
   */
  calcItemSizes: () => TreeItemSizes;

  /**
   * The root element of the tree.
   */
  root: HTMLElement;
}

/**
 * Options for `tree`.
 */
export interface TreeOptions<T> {
  /**
   * The tree model with all the items, two-way.
   * The tree re-sets this ref with a shallow root copy after every internal mutation.
   */
  model: Ref<TreeModel<T>>;

  /**
   * The highlighted tree item, two-way.
   * This option must be set to enable item highlighting.
   */
  highlightedItem?: Ref<TreeItemModel<T> | undefined>;

  /**
   * The selected tree items, two-way.
   * This option must be set to enable item selection.
   */
  selectedItems?: Ref<TreeItemModel<T>[]>;

  /**
   * Controls whether the expand button for tree items is always visible.
   *
   * @default
   * true
   */
  persistentExpandButton?: boolean;

  /**
   * A source structure the tree mirrors its mutations into, in place.
   * With it set, a user's duplicate, move, drop, delete, or cut updates both `model` and the source.
   * Omitted, those actions only call their callbacks, like `onDropItems`, and leave `model` untouched.
   * A duplicate gets a fresh 23-letter id, also written to its source item under `props.id`.
   */
  source?: TreeSource;

  /**
   * The duration in milliseconds to trigger dragging on touch devices.
   *
   * @default
   * 500
   */
  touchDuration?: number;

  /**
   * Size step of the component: -2 very small, -1 small, 0 default, 1 large, 2 very large.
   * Omitted inherits `--ohne-size` from the nearest ancestor.
   */
  size?: number;

  /**
   * Renders a custom icon for each item.
   */
  itemIcon?: (item: TreeItemModel<T>) => Child;

  /**
   * Renders a custom label for each item.
   */
  itemLabel?: (item: TreeItemModel<T>) => Child;

  /**
   * Called with the normalized selection when the user copies it.
   */
  onCopyItems?: (items: TreeItemModel<T>[], event: KeyboardEvent) => void;

  /**
   * Called with the normalized selection when the user cuts it.
   */
  onCutItems?: (items: TreeItemModel<T>[], event: KeyboardEvent) => void;

  /**
   * Called with the normalized selection when the user deletes it.
   */
  onDeleteItems?: (items: TreeItemModel<T>[], event: KeyboardEvent) => void;

  /**
   * Called with the normalized selection when the user duplicates it.
   */
  onDuplicateItems?: (items: TreeItemModel<T>[], event: KeyboardEvent) => void;

  /**
   * Called with the normalized selection when it is dropped on a target.
   */
  onDropItems?: (
    items: TreeItemModel<T>[],
    target: TreeItemModel<T>,
    zone: TreeDropTarget<T>['zone'],
  ) => void;

  /**
   * Called with the normalized selection when the user moves it down.
   */
  onMoveDownItems?: (items: TreeItemModel<T>[], event: KeyboardEvent) => void;

  /**
   * Called with the normalized selection when the user moves it up.
   */
  onMoveUpItems?: (items: TreeItemModel<T>[], event: KeyboardEvent) => void;

  /**
   * Receives the live handle at construction.
   */
  expose?: (handle: TreeHandle<T>) => void;
}

css`
  .ohne-tree {
    --ohne-background: var(--ohne-card);
    --ohne-foreground: var(--ohne-card-foreground);
    width: 100%;
    padding: 0.125rem;
    background-color: hsl(var(--ohne-background));
    border-radius: calc(var(--ohne-radius) - 0.125rem);
    font-size: calc(1rem + var(--ohne-size) * 0.125rem);
  }
`;

/**
 * A virtualized, multi-select, drag-droppable tree list with keyboard actions.
 * The nested model projects into a flat list of visible rows.
 * Only the rows inside the scroll window render, padded by spacer divs sized from the uniform row height.
 * Selection paints accent while the tree has focus or during touch drag.
 * It falls back to secondary otherwise.
 */
export function tree<T>(options: TreeOptions<T>): HTMLElement {
  const model = options.model;
  const focused = ref(false);
  const selectionOrigin = ref<TreeItemModel<T> | null>(null);
  const isDragging = ref(false);
  const isTouchDragging = ref(false);
  const dropTarget = ref<TreeDropTarget<T> | null>(null);
  const mousePaused = ref(false);
  const placeholderStart = ref(0);
  const placeholderEnd = ref(0);
  const hotkeys = useHotkeys();
  const hotkeyStops: (() => void)[] = [];

  let previouslyFocusedElement: Element | null = null;
  let hasInteracted = false;
  let placeholderItemHeight: number | undefined;
  let unpauseMouseTimeout: ReturnType<typeof setTimeout> | undefined;
  let unsetPlaceholderItemHeightTimeout: ReturnType<typeof setTimeout> | undefined;

  const activeItems = computed(() => activeTreeItems(model.value));
  const selectedItemIds = computed(() =>
    Object.fromEntries((options.selectedItems?.value ?? []).map((item) => [item.id, true])),
  );

  // Reactivity is shallow, so re-setting the root ref is what re-runs `activeItems` and the effects.
  const invalidate = (): void => {
    model.value = [...untracked(() => model.value)];
  };

  const selected = (): TreeItemModel<T>[] => options.selectedItems?.value ?? [];

  const flatItems = (): TreeItemModel<T>[] => flatTreeItems(model.value);

  const calcItemSizes = (): TreeItemSizes => {
    const baseFontSize = +getComputedStyle(document.documentElement)
      .getPropertyValue('font-size')
      .slice(0, -2);
    const sizeVar = getComputedStyle(root).getPropertyValue('--ohne-size');
    const size = sizeVar ? +sizeVar : 0;
    const em = baseFontSize + size * 0.125 * baseFontSize;
    const itemHeight = 2 * em + 0.25 * baseFontSize;

    return { baseFontSize, em, itemHeight };
  };

  const updatePlaceholder = (y: number): void => {
    clearTimeout(unsetPlaceholderItemHeightTimeout);
    unsetPlaceholderItemHeightTimeout = setTimeout(() => (placeholderItemHeight = undefined), 1000);

    if (isUndefined(placeholderItemHeight)) {
      placeholderItemHeight = calcItemSizes().itemHeight;
    }

    placeholderStart.value = Math.floor(y / placeholderItemHeight);
    placeholderEnd.value = Math.ceil((y + scrollableEl.offsetHeight) / placeholderItemHeight);
  };

  const focusPrevious = (event?: Event): void => {
    const highlighted = options.highlightedItem?.value;

    if (highlighted && !isDragging.value) {
      const item = prev(
        highlighted,
        activeItems.value.map(({ item }) => item),
        { prop: 'id' },
      );

      if (item?.id !== highlighted.id) {
        options.highlightedItem!.value = item;
        mousePaused.value = true;
        void nextTick().then(scrollToHighlighted);
        event?.preventDefault();
      }
    }
  };

  const focusNext = (event?: Event): void => {
    const highlighted = options.highlightedItem?.value;

    if (highlighted && !isDragging.value) {
      const item = next(
        highlighted,
        activeItems.value.map(({ item }) => item),
        { prop: 'id' },
      );

      if (item?.id !== highlighted.id) {
        options.highlightedItem!.value = item;
        mousePaused.value = true;
        void nextTick().then(scrollToHighlighted);
        event?.preventDefault();
      }
    }
  };

  const scrollToHighlighted = (): void => {
    const highlighted = options.highlightedItem?.value;
    if (highlighted) {
      scrollToItem(highlighted);
    }
  };

  const scrollToSelection = (): void => {
    if (selected().length) {
      scrollToItem(selected()[0]!);
    }
  };

  const scrollToItem = (item: TreeItemModel<T>): void => {
    const { em, itemHeight } = calcItemSizes();

    let offset = 0;
    let found = false;

    for (const active of activeItems.value) {
      if (active.item.id === item.id) {
        found = true;
        break;
      } else {
        offset++;
      }
    }

    let top = found ? itemHeight * offset : 0;

    // Reduce the top offset by the height of the top scroll button.
    if (top > 0 && (!scrollHandle.arrivedTop.value || !scrollHandle.arrivedBottom.value)) {
      top -= em;
    }

    scrollableEl.scrollTo({ top, behavior: 'instant' });
  };

  const scrollItems = (direction: 'up' | 'down'): void => {
    if (!mousePaused.value) {
      const { itemHeight } = calcItemSizes();

      scrollableEl.scrollTo({
        top: scrollableEl.scrollTop + (direction === 'up' ? -itemHeight : itemHeight),
        behavior: 'instant',
      });
    }
  };

  const sourceChildren = (parent?: TreeItemModel<T>): unknown[] =>
    ((parent?.source as Record<string, unknown> | undefined)?.[
      options.source!.props.children
    ] as unknown[]) ?? (options.source!.root as unknown[]);

  const duplicateItems = (items: TreeItemModel<T>[], event: Event): void => {
    event.preventDefault();

    const addedItems: TreeItemModel<T>[] = [];

    for (const item of items) {
      const clone = cloneTreeItem(item, options.source?.props.id);
      const added = addTreeItemsBefore([clone], item, model.value);

      addedItems.push(clone);

      if (options.source) {
        const source = added[0]!.parent?.source as Record<string, unknown> | undefined;
        const slot = (source?.[options.source.props.children] as unknown[]) ?? options.source.root;

        slot.splice(added[0]!.index, 0, clone.source);
      }
    }

    invalidate();

    if (options.selectedItems) {
      options.selectedItems.value = addedItems;
    }

    if (selectionOrigin.value) {
      const index = items.findIndex(({ id }) => id === selectionOrigin.value!.id);

      if (index > -1) {
        selectionOrigin.value = addedItems[index]!;
      }
    }

    setTimeout(() => {
      root.querySelector('button')?.focus();

      if (event instanceof KeyboardEvent && options.highlightedItem) {
        options.highlightedItem.value = undefined;
      }
    });
  };

  const deleteItems = (items: TreeItemModel<T>[], event: Event): void => {
    event.preventDefault();

    const deleted = deleteTreeItems(items, model.value);

    if (options.source) {
      for (const { item, parent } of deleted) {
        const slot = sourceChildren(parent);
        let index: number;
        do {
          index = slot.indexOf(item.source);
          if (index !== -1) slot.splice(index, 1);
        } while (index !== -1);
      }
    }

    invalidate();
  };

  const moveUpItems = (items: TreeItemModel<T>[], event: Event): void => {
    event.preventDefault();

    const moved = moveTreeItems(items, model.value, 'up');

    if (options.source) {
      for (const { item, parent, oldIndex, newIndex } of moved) {
        if (oldIndex !== newIndex) {
          const slot = sourceChildren(parent);
          slot.splice(oldIndex, 1);
          slot.splice(newIndex, 0, item.source);
        }
      }
    }

    invalidate();
  };

  const moveDownItems = (items: TreeItemModel<T>[], event: Event): void => {
    event.preventDefault();

    const moved = moveTreeItems(items, model.value, 'down');

    if (options.source) {
      for (const { item, parent, oldIndex, newIndex } of moved) {
        if (oldIndex !== newIndex) {
          const slot = sourceChildren(parent);
          slot.splice(oldIndex, 1);
          slot.splice(newIndex, 0, item.source);
        }
      }
    }

    invalidate();
  };

  const dropItems = (
    items: TreeItemModel<T>[],
    target: TreeItemModel<T>,
    zone: TreeDropTarget<T>['zone'],
  ): void => {
    const dropped = dropTreeItems(items, target, model.value, zone);

    if (options.source) {
      // Two passes: removal indexes are pre-insertion, so all removals must happen first.
      for (const { oldIndex, oldParent } of dropped) {
        sourceChildren(oldParent).splice(oldIndex, 1);
      }

      for (const { item, newIndex, newParent } of dropped) {
        sourceChildren(newParent).splice(newIndex, 0, item.source);
      }
    }

    invalidate();
  };

  const unpauseMouseDelayed = (): void => {
    if (mousePaused.value && !unpauseMouseTimeout) {
      unpauseMouseTimeout = setTimeout(() => {
        mousePaused.value = false;
        unpauseMouseTimeout = undefined;
      }, 150);
    }
  };

  const setPreviouslyFocusedElement = (): void => {
    previouslyFocusedElement = document.activeElement;
    hasInteracted = false;
  };

  const revertFocus = (): void => {
    if (!hasInteracted && previouslyFocusedElement instanceof HTMLElement) {
      if (previouslyFocusedElement !== root && root.contains(previouslyFocusedElement)) {
        previouslyFocusedElement.focus();
      } else if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }

      if (previouslyFocusedElement.nodeName !== 'BUTTON') {
        previouslyFocusedElement.focus();
      }
    }
  };

  let scrollHandle!: ScrollableHandle;

  const scrollableEl = scrollable(
    [
      h('div', {
        style: () => `height: calc(${placeholderStart.value} * (2em + 0.25rem))`,
      }),
      each(
        () =>
          activeItems.value
            .map((active, index) => ({ active, index }))
            .slice(placeholderStart.value, placeholderEnd.value + 1),
        ({ active }) => active.item.id,
        (row) =>
          treeItem<T>({
            model: () => row().active,
            activeIndex: () => row().index,
            tree: () => model.value,
            activeItems: () => activeItems.value,
            highlightedItem: () => options.highlightedItem?.value,
            selectedItems: selected,
            selectedItemIds: () => selectedItemIds.value,
            selectionOrigin,
            isDragging,
            isTouchDragging,
            dropTarget,
            mousePaused,
            touchDuration: options.touchDuration,
            persistentExpandButton: options.persistentExpandButton,
            icon: options.itemIcon,
            label: options.itemLabel,
            onHighlight: (item) => {
              if (options.highlightedItem) options.highlightedItem.value = item;
            },
            onSelect: (items) => {
              if (options.selectedItems) {
                options.selectedItems.value = sortTreeItems(items, model.value);
              }
            },
            onDrop: ({ item, zone }) => {
              isDragging.value = false;
              isTouchDragging.value = false;
              dropTarget.value = null;

              if (options.source) {
                dropItems(normalizeTreeSelection(selected(), model.value), item, zone);
              }

              options.onDropItems?.(normalizeTreeSelection(selected(), model.value), item, zone);
            },
            onFocusPrevious: focusPrevious,
            onFocusNext: focusNext,
            onTreeUpdate: invalidate,
            onMouseUp: () => {
              isDragging.value = false;
              isTouchDragging.value = false;
              dropTarget.value = null;
            },
          }),
      ),
      h('div', {
        style: () =>
          `height: calc(${activeItems.value.length - placeholderEnd.value - 1} * (2em + 0.25rem))`,
      }),
    ],
    {
      onScrollStep: scrollItems,
      expose: (handle) => (scrollHandle = handle),
    },
  );

  const root = h(
    'div',
    {
      orientation: 'vertical',
      role: 'tree',
      class: 'ohne-tree',
      style: () => {
        const accent = (focused.value && !isDragging.value) || isTouchDragging.value;
        return (
          (isUndefined(options.size) ? '' : `--ohne-size: ${options.size};`) +
            (accent
              ? ''
              : '--ohne-accent: var(--ohne-secondary);' +
                ' --ohne-accent-foreground: var(--ohne-secondary-foreground);') || undefined
        );
      },
      onClick: () => {
        hasInteracted = true;
      },
      onMouseenter: () => setPreviouslyFocusedElement(),
      onMouseleave: () => revertFocus(),
      onMousemove: () => unpauseMouseDelayed(),
    },
    scrollableEl,
  );

  root.addEventListener('focusin', () => {
    focused.value = true;
  });
  root.addEventListener('focusout', (event) => {
    focused.value = event.relatedTarget instanceof Node && root.contains(event.relatedTarget);
  });

  let firstModelRun = true;
  effect(() => {
    void model.value;

    if (firstModelRun) {
      firstModelRun = false;
      return;
    }

    untracked(() => {
      const flattened = flatTreeItems(model.value);
      const highlighted = options.highlightedItem?.value;

      if (highlighted && !flattened.find((item) => item.id === highlighted.id)) {
        options.highlightedItem!.value = undefined;
      }

      if (selected().length) {
        const ids = selectedItemIds.value;
        options.selectedItems!.value = flattened.filter((item) => ids[item.id]);
      }

      scrollHandle.isLocked.value = true;
      void nextTick().then(() => scrollHandle.measure());
      setTimeout(() => (scrollHandle.isLocked.value = false));
    });
  });

  effect(() => {
    const items = selected();
    const isFocused = focused.value;

    hotkeyStops.forEach((stop) => stop());
    hotkeyStops.length = 0;

    if (items.length && isFocused) {
      hotkeyStops.push(
        hotkeys.listen('copy', (event) => {
          options.onCopyItems?.(normalizeTreeSelection(items, model.value), event);
        }),
        hotkeys.listen('duplicate', (event) => {
          if (options.source) {
            duplicateItems(normalizeTreeSelection(items, model.value), event);
          }

          options.onDuplicateItems?.(normalizeTreeSelection(items, model.value), event);
        }),
        hotkeys.listen('cut', (event) => {
          const normalized = normalizeTreeSelection(items, model.value);

          if (options.source) {
            deleteItems(normalized, event);
          }

          options.onCutItems?.(normalized, event);
          if (options.selectedItems) options.selectedItems.value = [];
        }),
        hotkeys.listen('delete', (event) => {
          const normalized = normalizeTreeSelection(items, model.value);

          if (options.source) {
            deleteItems(normalized, event);
          }

          options.onDeleteItems?.(normalized, event);
          if (options.selectedItems) options.selectedItems.value = [];
        }),
        hotkeys.listen('moveUp', (event) => {
          const normalized = normalizeTreeSelection(items, model.value);

          if (options.source) {
            moveUpItems(normalized, event);
          }

          options.onMoveUpItems?.(normalized, event);

          setTimeout(() => {
            if (options.selectedItems) {
              options.selectedItems.value = sortTreeItems(options.selectedItems.value, model.value);
            }

            if (event instanceof KeyboardEvent && options.highlightedItem) {
              options.highlightedItem.value = undefined;
            }
          });
        }),
        hotkeys.listen('moveDown', (event) => {
          const normalized = normalizeTreeSelection(items, model.value);

          if (options.source) {
            moveDownItems(normalized, event);
          }

          options.onMoveDownItems?.(normalized, event);

          setTimeout(() => {
            if (options.selectedItems) {
              options.selectedItems.value = sortTreeItems(options.selectedItems.value, model.value);
            }

            if (event instanceof KeyboardEvent && options.highlightedItem) {
              options.highlightedItem.value = undefined;
            }
          });
        }),
      );
    }
  });

  effect(() => updatePlaceholder(scrollHandle.y.value));

  // The first run measures an unattached element, whose `offsetHeight` is 0.
  requestAnimationFrame(() => updatePlaceholder(scrollHandle.y.value));

  const stopClickOutside = listenClickOutside(root, () => {
    isDragging.value = false;
    isTouchDragging.value = false;
  });

  onCleanup(() => {
    stopClickOutside();
    hotkeyStops.forEach((stop) => stop());
    clearTimeout(unsetPlaceholderItemHeightTimeout);
    clearTimeout(unpauseMouseTimeout);
  });

  options.expose?.({
    activeItems,
    selectedItemIds,
    focused,
    flatItems,
    deleteItems,
    dropItems,
    duplicateItems,
    moveDownItems,
    moveUpItems,
    scrollToItem,
    scrollToSelection,
    scrollable: scrollHandle,
    updatePlaceholder,
    calcItemSizes,
    root,
  });

  return root;
}
