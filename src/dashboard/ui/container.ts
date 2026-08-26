import type { Ref } from '../../utils/reactive/ref.ts';
import type { Child } from '../render/insert.ts';

import { debounce } from '../../utils/debounce/debounce.ts';
import { onCleanup } from '../../utils/reactive/effect-scope.ts';
import { ref } from '../../utils/reactive/ref.ts';
import { css } from '../render/css.ts';
import { h } from '../render/h.ts';
import './tokens.ts';

/**
 * The nearest scrollable pane above `el`: its closest `.ohne-container` ancestor, if any.
 * Pickers lock and size against it when no explicit `scrollContainer` is passed.
 * The source injects the nearest `PUIContainer` the same way.
 *
 * @example
 * ```ts
 * nearestContainer(combobox) // -> the popup's scroll pane, or undefined outside one
 * ```
 */
export function nearestContainer(el: Element): HTMLElement | undefined {
  return el.closest<HTMLElement>('.ohne-container') ?? undefined;
}

/**
 * The structure item currently being dragged.
 */
export interface StructureDraggable {
  /**
   * The current item being dragged.
   */
  item: Record<string, unknown>;

  /**
   * The current item's index in the structure.
   */
  index: number;

  /**
   * The type of the item being dragged.
   */
  type: string | undefined;

  /**
   * Indicates if the drag operation was initiated through touch input.
   */
  touch: boolean;

  /**
   * The structure ID of the item being dragged.
   * If `null`, the item can be dropped in any structure, if its `type` is compatible.
   */
  structureId: string | null;

  /**
   * Function to remove the current draggable item from its current structure.
   */
  remove: (isSameStructure: boolean) => Record<string, unknown>[];
}

/**
 * The active structure drag, shared across every container and structure instance.
 * Non-null only while a structure item is being dragged; the structure component writes it.
 * The module-level ref replaces the source's `useState('pruvious-ui-structure-draggable')`.
 */
export const structureDraggable: Ref<StructureDraggable | null> = ref<StructureDraggable | null>(
  null,
);

/**
 * Options for `container`.
 */
export interface ContainerOptions {
  /**
   * Defines the scrolling speed in pixels per second.
   *
   * @default
   * 512
   */
  distance?: number;
}

css`
  .ohne-container {
    display: flex;
    flex-direction: column;
    outline: none;
    overflow-y: auto;
    scrollbar-width: thin;
    scrollbar-color: hsl(var(--ohne-foreground) / 0.25) transparent;
  }

  .ohne-container-scroll-button {
    flex-shrink: 0;
    position: sticky;
    z-index: 21;
    height: 1.5rem;
    cursor: default;
    visibility: hidden;
  }

  .ohne-container-scroll-button-active {
    visibility: visible;
  }

  .ohne-container-scroll-button:first-child {
    top: 0;
    margin-bottom: -1.5rem;
  }

  .ohne-container-scroll-button:last-child {
    bottom: 0;
    margin-top: -1.5rem;
  }

  .ohne-container-content {
    flex: 1;
  }
`;

/**
 * A scrollable flex column, ported 1-to-1 from Pruvious v4's `PUIContainer`.
 * Its invisible hover-to-scroll edge zones let users scroll during a non-touch structure drag.
 * Each sticky zone shows only while there is somewhere left to scroll in its direction.
 * Hovering one scrolls `distance` pixels per second; a manual wheel cancels the auto-scroll.
 * The source's legacy `mousewheel` listener becomes `wheel`.
 *
 * @example
 * ```ts
 * container(structureView)
 * ```
 */
export function container(
  content?: Child | (() => Child),
  options: ContainerOptions = {},
): HTMLElement {
  const distance = options.distance ?? 512;
  const isScrollTopButtonActive = ref(false);
  const isScrollBottomButtonActive = ref(false);

  let isScrolling = false;
  let animationFrame: number | undefined;
  let prevTime: number | undefined;
  let scrollDirection: 'up' | 'down' | undefined;

  const update = (): void => {
    isScrollTopButtonActive.value = root.scrollTop > 0;
    isScrollBottomButtonActive.value = root.scrollTop + root.clientHeight < root.scrollHeight - 1;
  };

  const updateDebounced = debounce(update, 30);

  const scrollHandler = (time: number): void => {
    if (isScrolling) {
      if (prevTime === undefined) {
        prevTime = time;
      }

      const elapsed = time - prevTime;
      const step = (elapsed / 1000) * distance;

      if (scrollDirection === 'up') {
        root.scrollTop -= step;
      } else {
        root.scrollTop += step;
      }

      prevTime = time;
      animationFrame = requestAnimationFrame(scrollHandler);
    }
  };

  const startScrolling = (direction: 'up' | 'down'): void => {
    isScrolling = true;
    scrollDirection = direction;
    animationFrame = requestAnimationFrame(scrollHandler);
  };

  const stopScrolling = (): void => {
    isScrolling = false;
    prevTime = undefined;
    scrollDirection = undefined;

    if (animationFrame !== undefined) {
      cancelAnimationFrame(animationFrame);
    }
  };

  const scrollButtonClass = (active: Ref<boolean>) => (): string =>
    'ohne-container-scroll-button' +
    (structureDraggable.value && !structureDraggable.value.touch && active.value
      ? ' ohne-container-scroll-button-active'
      : '');

  const contentEl = h('div', { class: 'ohne-container-content' }, content);

  const root = h(
    'div',
    {
      tabindex: '-1',
      class: 'ohne-container',
      onWheel: () => stopScrolling(),
    },
    h('div', {
      class: scrollButtonClass(isScrollTopButtonActive),
      onMouseenter: () => startScrolling('up'),
      onMouseleave: () => stopScrolling(),
    }),
    contentEl,
    h('div', {
      class: scrollButtonClass(isScrollBottomButtonActive),
      onMouseenter: () => startScrolling('down'),
      onMouseleave: () => stopScrolling(),
    }),
  );

  const observer = new ResizeObserver(() => {
    isScrollTopButtonActive.value = false;
    isScrollBottomButtonActive.value = false;
    updateDebounced();
  });
  observer.observe(contentEl);
  root.addEventListener('scroll', update, { passive: true });
  onCleanup(() => {
    observer.disconnect();
    updateDebounced.cancel();
    stopScrolling();
  });

  return root;
}
