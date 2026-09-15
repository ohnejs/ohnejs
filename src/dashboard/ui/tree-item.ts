import type { Child } from '../render/insert.ts';

import { isFunction } from '../../utils/is/is-function.ts';
import { isUndefined } from '../../utils/is/is-undefined.ts';
import { computed } from '../../utils/reactive/computed.ts';
import { onCleanup } from '../../utils/reactive/effect-scope.ts';
import { effect } from '../../utils/reactive/effect.ts';
import { type Ref, ref } from '../../utils/reactive/ref.ts';
import { untracked } from '../../utils/reactive/untracked.ts';
import { css } from '../render/css.ts';
import { each } from '../render/each.ts';
import { h } from '../render/h.ts';
import { when } from '../render/when.ts';
import { isMac } from './hotkeys.ts';
import { icon } from './icon.ts';
import {
  getChildTreeItems,
  type TreeDropTarget,
  type TreeExtendedItemModel,
  canDragTreeItems,
  type TreeItemModel,
  type TreeModel,
  treeItemAllows,
} from './tree-model.ts';
import './tokens.ts';

/**
 * Options for `treeItem`.
 */
export interface TreeItemOptions<T> {
  /**
   * The extended tree item model of this row, read reactively.
   */
  model: () => TreeExtendedItemModel<T>;

  /**
   * The tree model with all the items, read reactively.
   */
  tree: () => TreeModel<T>;

  /**
   * The active items in the tree, sorted by their UI appearance, read reactively.
   */
  activeItems: () => TreeExtendedItemModel<T>[];

  /**
   * The index of the tree item in the `activeItems`, read reactively.
   */
  activeIndex: () => number;

  /**
   * The highlighted tree item, read reactively.
   */
  highlightedItem?: () => TreeItemModel<T> | undefined;

  /**
   * The selected tree items, read reactively.
   */
  selectedItems: () => TreeItemModel<T>[];

  /**
   * The selected tree items as an object with the item ids as keys, read reactively.
   */
  selectedItemIds: () => Record<string, boolean>;

  /**
   * The tree item that initiates the selection, two-way.
   */
  selectionOrigin: Ref<TreeItemModel<T> | null>;

  /**
   * Whether the user is dragging items, two-way.
   */
  isDragging: Ref<boolean>;

  /**
   * Whether the user is dragging items on touch devices, two-way.
   */
  isTouchDragging: Ref<boolean>;

  /**
   * The tree item that is the drop target, two-way.
   */
  dropTarget: Ref<TreeDropTarget<T> | null>;

  /**
   * Whether mouse events for highlighting are paused, two-way.
   */
  mousePaused: Ref<boolean>;

  /**
   * The duration in milliseconds to trigger dragging on touch devices.
   *
   * @default
   * 500
   */
  touchDuration?: number;

  /**
   * Controls whether the expand button for tree items is always visible.
   *
   * @default
   * true
   */
  persistentExpandButton?: boolean;

  /**
   * Renders a custom icon for the item.
   * The wrapping icon span is only rendered when this option is given.
   */
  icon?: (item: TreeItemModel<T>) => Child;

  /**
   * Renders a custom label for the item.
   * If omitted, the item's `label` is displayed, falling back to its `id`.
   */
  label?: (item: TreeItemModel<T>) => Child;

  /**
   * Called with the item to highlight, or `undefined` to clear the highlight.
   */
  onHighlight: (item: TreeItemModel<T> | undefined) => void;

  /**
   * Called with the new selection.
   */
  onSelect: (items: TreeItemModel<T>[]) => void;

  /**
   * Called when the selected items are dropped on a target.
   */
  onDrop: (target: TreeDropTarget<T>) => void;

  /**
   * Called to move the highlight to the previous row.
   */
  onFocusPrevious: (event?: Event) => void;

  /**
   * Called to move the highlight to the next row.
   */
  onFocusNext: (event?: Event) => void;

  /**
   * Called after this row mutated the tree model in place, so the owner can invalidate it.
   */
  onTreeUpdate: () => void;

  /**
   * Called on a native `mouseup` on the row.
   */
  onMouseUp?: () => void;
}

css`
  .ohne-tree-item {
    position: relative;
    width: 100%;
    font-size: calc(1rem + var(--ohne-size, 0) * 0.125rem);
    line-height: 1.5;
  }

  .ohne-tree-item-selected-sibling::before {
    content: '';
    position: absolute;
    z-index: 0;
    top: calc(-1em - 0.125rem);
    right: 0;
    left: 0;
    height: calc(2em + 0.25rem);
    background-color: hsl(var(--ohne-accent));
    pointer-events: none;
  }

  .ohne-tree-item-button {
    position: relative;
    z-index: 1;
    display: flex;
    align-items: center;
    width: 100%;
    height: calc(2em + 0.25rem);
    padding-right: 0.5em;
    border-radius: calc(var(--ohne-radius) - 0.125rem);
    outline: none;
    cursor: default;
    color: hsl(var(--ohne-foreground));
  }

  .ohne-tree-item-button-highlighted {
    outline: 0.125rem solid hsl(var(--ohne-ring));
    outline-offset: -0.125rem;
  }

  .ohne-tree-item-button-selected {
    background-color: hsl(var(--ohne-accent));
    color: hsl(var(--ohne-accent-foreground));
  }

  .ohne-tree-item-toggle {
    flex-shrink: 0;
    display: flex;
    justify-content: center;
    align-items: center;
    width: calc(1em + 0.125rem);
    height: calc(1em + 0.125rem);
    color: hsl(var(--ohne-muted-foreground));
  }

  .ohne-tree-item-toggle-expanded svg {
    transform: rotate(90deg);
  }

  .ohne-tree-item-icon {
    flex-shrink: 0;
    display: flex;
    justify-content: center;
    align-items: center;
    width: 1em;
    height: 1em;
    margin-right: 0.375rem;
    overflow: hidden;
    color: hsl(var(--ohne-muted-foreground));
    font-size: calc(1em + 0.125rem);
  }

  .ohne-tree-item-button-selected .ohne-tree-item-icon {
    color: hsl(var(--ohne-foreground));
  }

  .ohne-tree-item-label {
    display: block;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .ohne-tree-item-zone-before,
  .ohne-tree-item-zone-inside,
  .ohne-tree-item-zone-after {
    position: absolute;
    z-index: 2;
    right: 0;
  }

  .ohne-tree-item-zone-before {
    top: -0.5em;
    height: 1em;
  }

  .ohne-tree-item-zone-inside {
    top: 0.5em;
    left: 0;
    height: calc(1em + 0.25rem);
  }

  .ohne-tree-item-zone-inside.ohne-tree-item-zone-visible::after {
    content: '';
    position: absolute;
    z-index: 1;
    top: -0.5em;
    right: 0;
    bottom: -0.5em;
    left: 0;
    outline: 0.125rem solid hsl(var(--ohne-ring));
    outline-offset: -0.125rem;
    border-radius: calc(var(--ohne-radius) - 0.125rem);
    pointer-events: none;
  }

  .ohne-tree-item-zone-after {
    bottom: -0.5em;
    height: 1em;
  }

  .ohne-tree-item-zone-before.ohne-tree-item-zone-visible::after,
  .ohne-tree-item-zone-after.ohne-tree-item-zone-visible::after {
    content: '';
    position: absolute;
    z-index: 1;
    top: 50%;
    right: 0;
    left: 0;
    height: 0.125rem;
    margin-top: -0.0625rem;
    background: hsl(var(--ohne-ring));
    border-radius: 0.125rem;
    pointer-events: none;
  }

  .ohne-tree-item-zone-before.ohne-tree-item-zone-inset.ohne-tree-item-zone-visible::after {
    margin-top: 0;
  }

  .ohne-tree-item-zone-after.ohne-tree-item-zone-inset.ohne-tree-item-zone-visible::after {
    margin-top: -0.125rem;
  }
`;

/**
 * One tree row: selection, highlight and focus, expand and collapse, drag initiation, drop-zone hit areas.
 * Only `tree` constructs it; the shared drag and selection state arrives through the options.
 */
export function treeItem<T>(options: TreeItemOptions<T>): HTMLElement {
  const touchDuration = options.touchDuration ?? 500;
  const persistentExpandButton = options.persistentExpandButton ?? true;
  const allowedBefore = ref(true);
  const allowedInside = ref(true);
  const allowedAfter = ref<Record<string, boolean>>({});
  const dragStops: (() => void)[] = [];

  let touchTimeout: ReturnType<typeof setTimeout> | undefined;

  const item = (): TreeItemModel<T> => options.model().item;

  const isDraggable = (): boolean => treeItemAllows(item(), 'draggable');

  const hasToggle = (): boolean => {
    const current = item();
    return current.nestable && (persistentExpandButton || Boolean(current.children?.length));
  };

  const isExpanded = (): boolean => {
    const current = item();
    return current.nestable && current.expanded === true;
  };

  const hasChildren = (): boolean => {
    const current = item();
    return current.nestable && Boolean(current.children?.length);
  };

  const parentAfterDropZones = computed(() => {
    const zones: { item: TreeItemModel<T>; level: number }[] = [];
    const model = options.model();
    const tree = options.tree();

    if (
      model.index === (model.parents[0]?.item.children ?? tree).length - 1 &&
      !model.descendants.length
    ) {
      for (const parent of options.activeItems()[options.activeIndex()]!.parents) {
        if (parent.index === (parent.parents[0]?.item.children ?? tree).length - 1) {
          zones.unshift({ item: parent.item, level: parent.parents.length });
        } else {
          break;
        }
      }
    }

    return zones;
  });

  const select = (event: MouseEvent | KeyboardEvent): void => {
    const current = item();

    if (current.selectable === false) {
      return;
    }

    const selected = options.selectedItems();
    const origin = options.selectionOrigin.value;

    if (event.shiftKey && origin) {
      const active = options.activeItems();
      const originIndex = active.findIndex(({ item }) => item.id === origin.id);
      const index = options.activeIndex();
      const [start, end] = originIndex < index ? [originIndex, index] : [index, originIndex];
      const union = [...selected, ...active.map(({ item }) => item).slice(start, end + 1)];

      options.onSelect(
        union
          .filter((entry, i) => union.findIndex(({ id }) => id === entry.id) === i)
          .filter(({ selectable }) => selectable !== false),
      );
    } else if (isMac() ? event.metaKey : event.ctrlKey) {
      if (selected.some(({ id }) => id === current.id)) {
        options.onSelect(selected.filter(({ id }) => id !== current.id));
      } else {
        options.onSelect([...selected, current]);
      }
    } else {
      options.onSelect([current]);
    }

    if (!origin || !event.shiftKey) {
      options.selectionOrigin.value = current;
    }
  };

  const expand = (): void => {
    const current = item();
    if (current.nestable && !current.expanded) {
      current.expanded = true;
      options.onTreeUpdate();
    }
  };

  const collapse = (): void => {
    const current = item();
    if (current.nestable && current.expanded) {
      current.expanded = false;
      options.onTreeUpdate();
    }
  };

  const listen = (target: EventTarget, type: string, handler: EventListener): (() => void) => {
    target.addEventListener(type, handler);
    return () => target.removeEventListener(type, handler);
  };

  const stopDragging = (): void => {
    options.isDragging.value = false;
    options.isTouchDragging.value = false;
    options.dropTarget.value = null;
    cleanupAfterDrag();
  };

  const cleanupAfterDrag = (): void => {
    allowedBefore.value = true;
    allowedInside.value = true;
    allowedAfter.value = {};
    dragStops.forEach((stop) => stop());
    dragStops.length = 0;
  };

  const handleDrag = (event: MouseEvent): void => {
    if (item().selectable === false) {
      event.preventDefault();
      return;
    }

    if (event.button > 0 || !isDraggable()) {
      return;
    }

    const [x, y] = [event.clientX, event.clientY];

    const stopMouseMove = listen(document, 'mousemove', ((move: MouseEvent) => {
      if (Math.abs(move.clientX - x) > 5 || Math.abs(move.clientY - y) > 5) {
        stopMouseMove();

        if (!options.selectedItems().some(({ id }) => id === item().id)) {
          select(move);
        }

        if (canDragTreeItems(options.selectedItems(), options.tree())) {
          options.isDragging.value = true;
          options.isTouchDragging.value = false;
        }
      }
    }) as EventListener);

    dragStops.push(
      stopMouseMove,
      listen(window, 'blur', stopDragging),
      listen(document, 'mouseup', stopDragging),
      listen(window, 'keydown', ((keyboard: KeyboardEvent) => {
        if (keyboard.key === 'Escape') stopDragging();
      }) as EventListener),
    );
  };

  const onTouchStart = (): void => {
    if (item().selectable !== false && isDraggable()) {
      touchTimeout = setTimeout(() => {
        options.onSelect([item()]);
        options.isDragging.value = true;
        options.isTouchDragging.value = true;
        clearTimeout(touchTimeout);
      }, touchDuration);
    }
  };

  const refuse = (zone: TreeDropTarget<T>['zone'], id: string | number): void => {
    // Untracked so a reactive class getter calling `canDrop` does not subscribe to its own memo.
    untracked(() => {
      if (zone === 'after') {
        if (allowedAfter.value[id] !== false) {
          allowedAfter.value = { ...allowedAfter.value, [id]: false };
        }
      } else if (zone === 'before') {
        allowedBefore.value = false;
      } else {
        allowedInside.value = false;
      }
    });
  };

  const canDrop = (zone: TreeDropTarget<T>['zone'], target?: TreeItemModel<T>): boolean => {
    const current = target ?? item();
    const selected = options.selectedItems();

    if (
      isFunction(current.droppable) ? current.droppable(selected, current, zone) : current.droppable
    ) {
      if (zone === 'inside' && selected.some(({ id }) => id === current.id)) {
        refuse('inside', current.id);
        return false;
      }

      if (
        selected.some((selectedItem) =>
          getChildTreeItems(selectedItem, options.tree()).some(({ id }) => id === current.id),
        )
      ) {
        refuse(zone, current.id);
        return false;
      }

      return true;
    }

    refuse(zone, current.id);
    return false;
  };

  const button = h(
    'button',
    {
      type: 'button',
      class: () => {
        const current = item();
        return (
          'ohne-tree-item-button ohne-raw' +
          (current.id === options.highlightedItem?.()?.id && !options.isDragging.value
            ? ' ohne-tree-item-button-highlighted'
            : '') +
          (current.selectable !== false ? ' ohne-tree-item-button-selectable' : '') +
          (options.selectedItemIds()[current.id] ? ' ohne-tree-item-button-selected' : '')
        );
      },
      style: () => {
        const base = `0.25rem + (${options.model().parents.length} * (1em + 0.125rem))`;
        return hasToggle()
          ? `padding-left: calc(${base})`
          : `padding-left: calc(${base} + (1em + 0.125rem))`;
      },
      onBlur: () => options.onHighlight(undefined),
      onClick: (event: MouseEvent) => select(event),
      onContextmenu: (event: MouseEvent) => {
        event.preventDefault();
        select(event);
      },
      onFocus: () => options.onHighlight(item()),
      onKeydown: (event: KeyboardEvent) => {
        if (event.key === 'ArrowDown') {
          if (!event.ctrlKey && !event.metaKey) {
            event.preventDefault();
            options.onFocusNext();
          }
        } else if (event.key === 'ArrowUp') {
          if (!event.ctrlKey && !event.metaKey) {
            event.preventDefault();
            options.onFocusPrevious();
          }
        } else if (event.key === 'ArrowLeft') {
          event.stopPropagation();
          if (!event.ctrlKey && !event.metaKey) {
            event.preventDefault();
            collapse();
          }
        } else if (event.key === 'ArrowRight') {
          event.stopPropagation();
          if (!event.ctrlKey && !event.metaKey) {
            event.preventDefault();
            expand();
          }
        } else if (event.key === 'Tab') {
          if (!event.ctrlKey && !event.metaKey) {
            if (event.shiftKey) options.onFocusPrevious(event);
            else options.onFocusNext(event);
          }
        }
      },
      onMousedown: handleDrag,
      onMouseenter: () => {
        if (item().selectable !== false && !options.mousePaused.value) {
          options.onHighlight(item());
        }
      },
      onMouseleave: () => {
        if (!options.mousePaused.value) {
          options.onHighlight(undefined);
        }
      },
      onMousemove: () => {
        if (item().selectable !== false && item().id !== options.highlightedItem?.()?.id) {
          options.onHighlight(item());
        }

        if (options.mousePaused.value) {
          options.mousePaused.value = false;
        }
      },
      onTouchstart: () => onTouchStart(),
    },
    when(hasToggle, () =>
      h(
        'span',
        {
          class: () =>
            'ohne-tree-item-toggle' + (isExpanded() ? ' ohne-tree-item-toggle-expanded' : ''),
          onClick: (event: MouseEvent) => {
            event.stopPropagation();
            if (isExpanded()) collapse();
            else expand();
          },
        },
        icon('chevron-right'),
      ),
    ),
    options.icon ? h('span', { class: 'ohne-tree-item-icon' }, () => options.icon!(item())) : null,
    h('span', { class: 'ohne-tree-item-label' }, () =>
      options.label ? options.label(item()) : (item().label ?? item().id),
    ),
  );

  const zoneVisible = (zone: TreeDropTarget<T>['zone'], target?: TreeItemModel<T>): boolean => {
    const id = (target ?? item()).id;
    const dropTarget = options.dropTarget.value;
    return (
      (dropTarget?.item.id === id && dropTarget.zone === zone) ||
      (options.isTouchDragging.value && canDrop(zone, target))
    );
  };

  const root = h(
    'div',
    {
      role: 'treeitem',
      'aria-expanded': () => {
        const current = item();
        return current.nestable && current.children?.length
          ? isUndefined(current.expanded)
            ? undefined
            : String(current.expanded)
          : undefined;
      },
      class: () => {
        const ids = options.selectedItemIds();
        const previous = options.activeItems()[options.activeIndex() - 1];
        return (
          'ohne-tree-item' +
          (ids[item().id] && previous && ids[previous.item.id]
            ? ' ohne-tree-item-selected-sibling'
            : '')
        );
      },
      onMouseup: () => options.onMouseUp?.(),
    },
    button,
    when(
      () => options.isDragging.value && allowedBefore.value,
      () =>
        h('div', {
          class: () =>
            'ohne-tree-item-zone-before' +
            (zoneVisible('before') ? ' ohne-tree-item-zone-visible' : '') +
            (options.activeIndex() === 0 ? ' ohne-tree-item-zone-inset' : ''),
          style: () => `left: calc(${options.model().parents.length} * 1.5em + 1em + 0.125rem)`,
          onMouseenter: () => {
            if (canDrop('before')) options.dropTarget.value = { item: item(), zone: 'before' };
          },
          onMouseleave: () => (options.dropTarget.value = null),
          onMouseup: () => {
            if (canDrop('before')) options.onDrop({ item: item(), zone: 'before' });
          },
        }),
    ),
    when(
      () => options.isDragging.value && item().nestable && allowedInside.value,
      () =>
        h('div', {
          class: () =>
            'ohne-tree-item-zone-inside' +
            (options.dropTarget.value?.item.id === item().id &&
            options.dropTarget.value?.zone === 'inside'
              ? ' ohne-tree-item-zone-visible'
              : ''),
          onMouseenter: () => {
            if (canDrop('inside')) options.dropTarget.value = { item: item(), zone: 'inside' };
          },
          onMouseleave: () => (options.dropTarget.value = null),
          onMouseup: () => {
            if (canDrop('inside')) options.onDrop({ item: item(), zone: 'inside' });
          },
        }),
    ),
    when(
      () =>
        options.isDragging.value &&
        allowedAfter.value[item().id] !== false &&
        (!item().nestable || !isExpanded() || !hasChildren()),
      () =>
        h('div', {
          class: () =>
            'ohne-tree-item-zone-after' +
            (zoneVisible('after') ? ' ohne-tree-item-zone-visible' : '') +
            (options.activeIndex() === options.activeItems().length - 1
              ? ' ohne-tree-item-zone-inset'
              : ''),
          style: () =>
            `z-index: ${3 + parentAfterDropZones.value.length}; ` +
            `left: calc(${options.model().parents.length} * 1.5em + 1em + 0.125rem)`,
          onMouseenter: () => {
            if (canDrop('after')) options.dropTarget.value = { item: item(), zone: 'after' };
          },
          onMouseleave: () => (options.dropTarget.value = null),
          onMouseup: () => {
            if (canDrop('after')) options.onDrop({ item: item(), zone: 'after' });
          },
        }),
    ),
    when(
      () => options.isDragging.value,
      () =>
        each(
          () => parentAfterDropZones.value,
          (zone) => zone.item.id,
          (zone, index) =>
            when(
              () => allowedAfter.value[zone().item.id] !== false,
              () =>
                h('div', {
                  class: () =>
                    'ohne-tree-item-zone-after' +
                    (zoneVisible('after', zone().item) ? ' ohne-tree-item-zone-visible' : '') +
                    (options.activeIndex() === options.activeItems().length - 1
                      ? ' ohne-tree-item-zone-inset'
                      : ''),
                  style: () =>
                    `z-index: ${3 + index()}; ` +
                    `left: calc(${zone().level} * 1.5em + 1em + 0.125rem)`,
                  onMouseenter: () => {
                    if (canDrop('after', zone().item)) {
                      options.dropTarget.value = { item: zone().item, zone: 'after' };
                    }
                  },
                  onMouseleave: () => (options.dropTarget.value = null),
                  onMouseup: () => {
                    if (canDrop('after', zone().item)) {
                      options.onDrop({ item: zone().item, zone: 'after' });
                    }
                  },
                }),
            ),
        ),
    ),
  );

  // Skipping the construction-time highlight keeps a virtualized row from stealing focus on scroll.
  let firstHighlight = true;
  effect(() => {
    const highlighted = options.highlightedItem?.();
    if (firstHighlight) {
      firstHighlight = false;
      return;
    }
    if (highlighted?.id === untracked(() => item().id)) {
      button.focus();
    }
  });

  let firstDragging = true;
  effect(() => {
    const dragging = options.isDragging.value;
    if (firstDragging) {
      firstDragging = false;
      return;
    }
    if (!dragging) {
      untracked(cleanupAfterDrag);
    }
  });

  const onTouchEnd = (): void => {
    clearTimeout(touchTimeout);
    if (options.isDragging.value) {
      setTimeout(() => window.getSelection()?.removeAllRanges(), 50);
    }
  };
  window.addEventListener('touchend', onTouchEnd);

  onCleanup(() => {
    window.removeEventListener('touchend', onTouchEnd);
    clearTimeout(touchTimeout);
  });

  return root;
}
