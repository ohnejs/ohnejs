import type { Ref } from '../../utils/reactive/ref.ts';
import type { Child } from '../render/insert.ts';
import type { ScrollableHandle } from './scrollable.ts';

import { debounce } from '../../utils/debounce/debounce.ts';
import { isUndefined } from '../../utils/is/is-undefined.ts';
import { computed } from '../../utils/reactive/computed.ts';
import { onCleanup } from '../../utils/reactive/effect-scope.ts';
import { effect } from '../../utils/reactive/effect.ts';
import { nextTick } from '../../utils/reactive/next-tick.ts';
import { css } from '../render/css.ts';
import { each } from '../render/each.ts';
import { h } from '../render/h.ts';
import { when } from '../render/when.ts';
import { nearestContainer, structureDraggable } from './container.ts';
import { listenClickOutside } from './overlay.ts';
import { structureItem } from './structure-item.ts';
import { structureAccepts, structureDropIndex } from './structure-model.ts';
import './tokens.ts';

/**
 * The live surface a `structure` exposes to its caller.
 */
export interface StructureHandle {
  /**
   * Snapshots the current scroll offset and starts reverting every later change to it.
   * A drop calls it before mutating the list, so DOM reflow cannot visually jump the page.
   */
  resumeScrollWatcher(): void;

  /**
   * Releases the scroll freeze 250 milliseconds after the last call.
   */
  pauseScrollWatcher(): void;
}

/**
 * Options for `structure`.
 */
export interface StructureOptions<TItem extends Record<string, unknown>> {
  /**
   * An array of unique identifiers representing different item types.
   * Types are used to filter the items that can be added to the structure.
   * If not provided, the structure supports adding any item type.
   */
  types?: string[];

  /**
   * A function to resolve the type of an item.
   * Receives the item as parameter and returns the item type.
   */
  resolveItemType?: (item: TItem) => string | undefined;

  /**
   * Controls whether the items in the structure can be dragged.
   *
   * @default
   * true
   */
  isDraggable?: boolean;

  /**
   * Controls whether the items in the structure can be dropped in other structure components.
   *
   * @default
   * false
   */
  allowCrossDrop?: boolean;

  /**
   * Text label for the empty dropzone.
   *
   * @default
   * 'Drop items here'
   */
  dropItemsHereLabel?: string;

  /**
   * Disables the structure reactively while it returns `true`, making it read-only.
   */
  disabled?: () => boolean;

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
   * The scroll surface the freezer pins during a drop.
   * Omitted, the freezer targets `window`, which has no reactive offset.
   * So only an explicit surface actually re-triggers the revert.
   */
  scroll?: ScrollableHandle;

  /**
   * Renders an item's card header, receiving reactive item and index accessors.
   * Omitted, the item cards render without headers and without drag handles.
   */
  header?: (item: () => TItem, index: () => number) => Child;

  /**
   * Renders an item's card body, receiving reactive item and index accessors.
   * The body hides while the item carries `$expanded === false`.
   */
  item?: (item: () => TItem, index: () => number) => Child;

  /**
   * Renders extra content before each item's card, receiving reactive item and index accessors.
   */
  itemBefore?: (item: () => TItem, index: () => number) => Child;

  /**
   * Renders extra content after each item's card, receiving reactive item and index accessors.
   */
  itemAfter?: (item: () => TItem, index: () => number) => Child;

  /**
   * Called with the settled list after a completed drop.
   * Also called when an item leaves this structure through a cross-structure drop.
   */
  onCommit?: (items: TItem[]) => void;

  /**
   * Receives the live handle with the scroll-freezer controls.
   */
  expose?: (handle: StructureHandle) => void;
}

let structureCount = 0;

css`
  .ohne-structure {
    --ohne-base-size: var(--ohne-size);
    width: 100%;
    font-size: calc(1rem + var(--ohne-size) * 0.125rem);
  }

  .ohne-structure-items {
    display: flex;
    flex-direction: column;
    gap: var(--ohne-gap, 0.75rem);
  }

  .ohne-structure-empty-zone {
    display: flex;
    justify-content: center;
    align-items: center;
    min-height: 2rem;
    padding: 0.25rem 0.75rem;
    background-color: hsl(var(--ohne-card));
    border-width: 1px;
    border-style: dashed;
    border-radius: var(--ohne-radius);
    color: hsl(var(--ohne-muted-foreground));
    font-size: calc(1em - 0.0625rem);
  }

  .ohne-structure-empty-zone:hover,
  .ohne-structure-empty-zone-highlighted {
    border-width: 2px;
    border-style: solid;
    border-color: hsl(var(--ohne-primary));
  }
`;

/**
 * A vertical list of card items with cross-list drag-drop reorder.
 *
 * Every instance shares the `structureDraggable` signal.
 * A drag started in one structure lights up the drop zones of every structure that accepts it.
 * A mouseup over a zone moves the item.
 * A same-structure drop reorders in place.
 * A cross-structure drop inserts here first and removes from the donor a tick later.
 * So the item transiently exists in both lists.
 * `onCommit` fires two ticks after a drop, once the model has settled, and on a cross-structure departure.
 * While empty and accepting, the structure renders a dashed dropzone with `dropItemsHereLabel`.
 * A click outside cancels an in-flight drag without dropping.
 *
 * @example
 * ```ts
 * const blocks = ref<Record<string, unknown>[]>([])
 * structure(blocks, { header: (item) => () => String(item().name) })
 * ```
 */
export function structure<TItem extends Record<string, unknown>>(
  model: Ref<TItem[]>,
  options: StructureOptions<TItem> = {},
): HTMLElement {
  const id = `ohne-structure-${++structureCount}`;
  const disabled = options.disabled ?? ((): boolean => false);
  const isDraggable = options.isDraggable ?? true;
  const allowCrossDrop = options.allowCrossDrop ?? false;
  const touchDuration = options.touchDuration ?? 500;
  const dropItemsHereLabel = options.dropItemsHereLabel ?? 'Drop items here';

  const droppable = computed(() =>
    structureAccepts(structureDraggable.value, id, allowCrossDrop, options.types),
  );

  let prevScrollY = 0;
  let prevPaneY = 0;
  let stopFreeze: (() => void) | null = null;
  let unfreezePane: (() => void) | null = null;

  const freeze = (): void => {
    const y = options.scroll ? options.scroll.y.value : window.scrollY;
    if (y !== prevScrollY) {
      if (options.scroll) options.scroll.y.value = prevScrollY;
      else window.scrollTo({ top: prevScrollY, behavior: 'instant' });
    }
  };

  const pauseScrollWatcher = debounce(() => {
    stopFreeze?.();
    stopFreeze = null;
    unfreezePane?.();
    unfreezePane = null;
  }, 250);

  const resumeScrollWatcher = (): void => {
    prevScrollY = options.scroll ? options.scroll.y.value : window.scrollY;
    stopFreeze ??= effect(freeze);
    // The effect alone cannot revert a non-reactive offset, so the pane pins on its scroll events.
    const pane = options.scroll ? undefined : nearestContainer(root);
    if (pane && !unfreezePane) {
      prevPaneY = pane.scrollTop;
      const pin = (): void => {
        if (pane.scrollTop !== prevPaneY) pane.scrollTop = prevPaneY;
      };
      pane.addEventListener('scroll', pin);
      unfreezePane = () => pane.removeEventListener('scroll', pin);
    }
  };

  const setDraggable = (
    value: { item: Record<string, unknown>; touch: boolean } | null,
    index: () => number,
  ): void => {
    if (!value) {
      structureDraggable.value = null;
      return;
    }

    const i = index();
    structureDraggable.value = {
      ...value,
      index: i,
      type: options.resolveItemType?.(value.item as TItem),
      structureId: allowCrossDrop ? null : id,
      remove: (isSameStructure) => {
        const items = model.value.filter((_, j) => i !== j);
        model.value = items;
        if (!isSameStructure) options.onCommit?.(items);
        return items;
      },
    };
  };

  const onDrop = (index: number, position: 'before' | 'after'): void => {
    const draggable = structureDraggable.value;
    if (!draggable) return;

    const { item, index: draggableIndex, remove } = draggable;
    const isSameStructure = model.value.includes(item as TItem);

    resumeScrollWatcher();

    const at = structureDropIndex(index, position, isSameStructure ? draggableIndex : null);

    if (isSameStructure) {
      const items = remove(isSameStructure) as TItem[];
      model.value = [...items.slice(0, at), item as TItem, ...items.slice(at)];
    } else {
      model.value = [...model.value.slice(0, at), item as TItem, ...model.value.slice(at)];
      void nextTick().then(() => remove(isSameStructure));
    }

    // Double tick so the commit observes the settled value even after a cross-structure removal.
    void nextTick().then(() => nextTick().then(() => options.onCommit?.(model.value)));

    pauseScrollWatcher();
    structureDraggable.value = null;
  };

  const itemsList = (): HTMLElement =>
    h(
      'div',
      { class: 'ohne-structure-items' },
      each(
        () => model.value,
        (item, index) => item.$key ?? index,
        (item, index) => [
          options.itemBefore?.(item, index),
          structureItem({
            item,
            header: options.header && ((): Child => options.header!(item, index)),
            body: options.item && ((): Child => options.item!(item, index)),
            isDraggable,
            droppable: () => droppable.value,
            disabled,
            touchDuration,
            onDraggable: (value) => setDraggable(value, index),
            onDrop: (position) => onDrop(index(), position),
          }),
          options.itemAfter?.(item, index),
        ],
      ),
    );

  const emptyZone = (): HTMLElement =>
    h(
      'div',
      {
        class: () =>
          'ohne-structure-empty-zone' +
          (structureDraggable.value?.touch ? ' ohne-structure-empty-zone-highlighted' : ''),
        onMouseup: () => onDrop(0, 'before'),
      },
      h('p', null, dropItemsHereLabel),
    );

  options.expose?.({ resumeScrollWatcher, pauseScrollWatcher });

  onCleanup(() => {
    pauseScrollWatcher.cancel();
    stopFreeze?.();
    stopFreeze = null;
    unfreezePane?.();
    unfreezePane = null;
  });

  const root = h(
    'div',
    {
      class: () =>
        'ohne-structure' +
        (disabled() ? ' ohne-structure-disabled' : '') +
        (model.value.length ? '' : ' ohne-structure-empty') +
        (!model.value.length && droppable.value && !disabled() ? ' ohne-structure-dropzone' : ''),
      style: isUndefined(options.size) ? undefined : `--ohne-size: ${options.size}`,
    },
    when(
      () => model.value.length > 0 || (droppable.value && !disabled()),
      () => {
        const containerEl = h(
          'div',
          null,
          when(
            () => model.value.length > 0,
            itemsList,
            () => when(() => droppable.value && !disabled(), emptyZone),
          ),
        );
        onCleanup(
          listenClickOutside(containerEl, () => {
            if (droppable.value) structureDraggable.value = null;
          }),
        );
        return containerEl;
      },
    ),
  );

  return root;
}
