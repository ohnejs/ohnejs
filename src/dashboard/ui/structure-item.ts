import type { Child } from '../render/insert.ts';

import { onCleanup } from '../../utils/reactive/effect-scope.ts';
import { effect } from '../../utils/reactive/effect.ts';
import { css } from '../render/css.ts';
import { h } from '../render/h.ts';
import { when } from '../render/when.ts';
import { card } from './card.ts';
import { structureDraggable } from './container.ts';
import { icon } from './icon.ts';
import './tokens.ts';

/**
 * Options for `structureItem`.
 */
export interface StructureItemOptions {
  /**
   * The value of the structure item, read through a reactive accessor.
   * The magic key `$expanded` collapses the item's body while it is `false`.
   */
  item: () => Record<string, unknown>;

  /**
   * Content of the card header row, rendered after the drag handle.
   * Omitted, the card renders without a header and without a drag handle.
   */
  header?: Child | (() => Child);

  /**
   * Content of the item body, hidden while the item is collapsed.
   * Omitted, the card body holds only the drop zones.
   */
  body?: Child | (() => Child);

  /**
   * Controls whether the item can be dragged.
   *
   * @default
   * true
   */
  isDraggable?: boolean;

  /**
   * Reports reactively whether a draggable item can be dropped before or after this item.
   * The drop zones render only while it returns `true`.
   */
  droppable: () => boolean;

  /**
   * Hides the drag handle reactively while it returns `true`.
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
   * Reports a drag start with the item and its input mode, and a drag end with `null`.
   */
  onDraggable: (value: { item: Record<string, unknown>; touch: boolean } | null) => void;

  /**
   * Reports a drop on the before or after zone.
   */
  onDrop: (position: 'before' | 'after') => void;
}

css`
  .ohne-structure-item {
    --ohne-padding-header: 0.5rem;
    position: relative;
  }

  .ohne-structure-item-collapsed .ohne-card-body {
    padding: 0;
    border-top: none;
  }

  .ohne-structure-item-collapsed .ohne-structure-item-inner {
    display: none;
  }

  .ohne-structure-item-header {
    min-height: 2em;
  }

  .ohne-structure-drag-handle {
    flex-shrink: 0;
    position: relative;
    display: flex;
    justify-content: center;
    align-items: center;
    width: 2em;
    height: 2em;
    margin: 0 -0.375rem;
    cursor: move;
    color: hsl(var(--ohne-foreground));
    outline: none;
  }

  .ohne-structure-item-inner {
    container-type: inline-size;
    margin: 0;
    transition: var(--ohne-transition);
    transition-property: opacity;
  }

  .ohne-structure-item-dragging .ohne-structure-item-inner {
    opacity: 0.36;
    pointer-events: none;
  }

  .ohne-structure-item-zone-before,
  .ohne-structure-item-zone-after {
    position: absolute;
    z-index: 2;
    right: 0;
    left: 0;
    opacity: 0;
  }

  .ohne-structure-item-zone-before:hover,
  .ohne-structure-item-zone-after:hover,
  .ohne-structure-item-zone-visible {
    opacity: 1;
  }

  .ohne-structure-item-zone-before {
    top: calc(-1.25 * var(--ohne-gap, 0.75rem) - 1px);
    height: calc(1.5 * var(--ohne-gap, 0.75rem));
  }

  .ohne-structure-item-zone-after {
    bottom: calc(-1.25 * var(--ohne-gap, 0.75rem) - 1px);
    height: calc(1.5 * var(--ohne-gap, 0.75rem));
  }

  .ohne-structure-item-zone-before::after,
  .ohne-structure-item-zone-after::after {
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

  .ohne-structure-item-zone-before span,
  .ohne-structure-item-zone-after span {
    position: absolute;
    z-index: 2;
    top: 50%;
    left: 50%;
    display: flex;
    justify-content: center;
    align-items: center;
    width: 1.5em;
    height: 1em;
    background-color: hsl(var(--ohne-primary));
    border-radius: calc(var(--ohne-radius) - 0.125rem);
    color: hsl(var(--ohne-primary-foreground));
    transform: translate3d(-50%, -50%, 0);
  }
`;

/**
 * One structure card.
 *
 * The header carries a drag handle.
 * A primary mouse press followed by more than 5px of travel reports the drag through `onDraggable`.
 * So does a `touchDuration` press on touch devices.
 * Window blur, a document mouseup, or Escape ends the drag with `onDraggable(null)`.
 * While `droppable` reports `true`, invisible before/after zones cover the list gaps.
 * They report a mouseup as `onDrop`; a touch drag keeps them visible.
 * The dragged card dims its body, and `$expanded === false` collapses it.
 */
export function structureItem(options: StructureItemOptions): HTMLElement {
  const isDraggable = options.isDraggable ?? true;
  const disabled = options.disabled ?? ((): boolean => false);
  const touchDuration = options.touchDuration ?? 500;

  const dragStops: (() => void)[] = [];
  let touchTimeout: ReturnType<typeof setTimeout> | undefined;

  const stopDragging = (): void => {
    options.onDraggable(null);
    for (const stop of dragStops) stop();
    dragStops.length = 0;
  };

  const handleDrag = (event: MouseEvent): void => {
    if (event.button > 0 || !isDraggable) return;

    const [x, y] = [event.clientX, event.clientY];
    const onMouseMove = (moveEvent: MouseEvent): void => {
      if (Math.abs(moveEvent.clientX - x) > 5 || Math.abs(moveEvent.clientY - y) > 5) {
        options.onDraggable({ item: options.item(), touch: false });
        stopMouseMove();
      }
    };
    const stopMouseMove = (): void => document.removeEventListener('mousemove', onMouseMove);
    const onBlur = (): void => stopDragging();
    const onMouseUp = (): void => stopDragging();
    const onEscape = (keyEvent: KeyboardEvent): void => {
      if (keyEvent.key === 'Escape') stopDragging();
    };

    document.addEventListener('mousemove', onMouseMove);
    window.addEventListener('blur', onBlur);
    document.addEventListener('mouseup', onMouseUp);
    window.addEventListener('keydown', onEscape);
    dragStops.push(
      stopMouseMove,
      () => window.removeEventListener('blur', onBlur),
      () => document.removeEventListener('mouseup', onMouseUp),
      () => window.removeEventListener('keydown', onEscape),
    );
  };

  const onTouchStart = (): void => {
    if (isDraggable) {
      touchTimeout = setTimeout(() => {
        options.onDraggable({ item: options.item(), touch: true });
      }, touchDuration);
    }
  };

  const onTouchEnd = (): void => {
    clearTimeout(touchTimeout);
    if (options.droppable()) {
      setTimeout(() => window.getSelection()?.removeAllRanges(), 50);
    }
  };
  window.addEventListener('touchend', onTouchEnd);

  onCleanup(() => {
    window.removeEventListener('touchend', onTouchEnd);
    clearTimeout(touchTimeout);
  });

  const zone = (position: 'before' | 'after'): (() => Child) =>
    when(
      () => options.droppable(),
      () =>
        h(
          'div',
          {
            class: () =>
              `ohne-structure-item-zone-${position}` +
              (structureDraggable.value?.touch ? ' ohne-structure-item-zone-visible' : ''),
            onMouseup: () => options.onDrop(position),
          },
          h('span', null, icon('grip-horizontal')),
        ),
    );

  const root = card(
    [
      zone('before'),
      options.body === undefined
        ? null
        : when(
            () => options.item().$expanded !== false,
            () => h('div', { class: 'ohne-structure-item-inner' }, options.body),
          ),
      zone('after'),
    ],
    {
      header:
        options.header === undefined
          ? undefined
          : h(
              'div',
              { class: 'ohne-structure-item-header ohne-row' },
              when(
                () => isDraggable && !disabled(),
                () =>
                  h(
                    'button',
                    {
                      tabindex: '-1',
                      type: 'button',
                      class: 'ohne-structure-drag-handle ohne-raw',
                      onMousedown: handleDrag,
                      onTouchstart: (event: TouchEvent) => {
                        event.preventDefault();
                        onTouchStart();
                      },
                    },
                    icon('grip-vertical'),
                  ),
              ),
              options.header,
            ),
    },
  );

  root.classList.add('ohne-structure-item');
  effect(() => {
    const item = options.item();
    root.classList.toggle('ohne-structure-item-dragging', structureDraggable.value?.item === item);
    root.classList.toggle('ohne-structure-item-collapsed', item.$expanded === false);
  });

  return root;
}
