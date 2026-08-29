import type { Child } from '../render/insert.ts';

import { debounce } from '../../utils/debounce/debounce.ts';
import { onCleanup } from '../../utils/reactive/effect-scope.ts';
import { effect } from '../../utils/reactive/effect.ts';
import { type Ref, ref } from '../../utils/reactive/ref.ts';
import { css } from '../render/css.ts';
import { h } from '../render/h.ts';
import { icon } from './icon.ts';
import './tokens.ts';

/**
 * The live surface a `scrollable` exposes to its caller.
 */
export interface ScrollableHandle {
  /**
   * The vertical scroll offset in pixels, two-way: writing scrolls the container instantly.
   */
  y: Ref<number>;

  /**
   * Whether the view rests at the top edge.
   */
  arrivedTop: Ref<boolean>;

  /**
   * Whether the view rests at the bottom edge, with a 1px tolerance for fractional positions.
   */
  arrivedBottom: Ref<boolean>;

  /**
   * Whether the top edge button is showing.
   */
  isTopButtonVisible: Ref<boolean>;

  /**
   * Whether the bottom edge button is showing.
   */
  isBottomButtonVisible: Ref<boolean>;

  /**
   * The scroll lock; set `true` to freeze the container.
   */
  isLocked: Ref<boolean>;

  /**
   * Re-reads the edge states from the DOM.
   */
  measure(): void;
}

/**
 * Options for `scrollable`.
 */
export interface ScrollableOptions {
  /**
   * Pixels the content self-scrolls per step while a scroll button is hovered.
   * `0` disables self-scrolling; the caller can still react through `onScrollStep`.
   *
   * @default
   * 0
   */
  autoScroll?: number;

  /**
   * The interval in milliseconds between steps while a scroll button is hovered.
   *
   * @default
   * 50
   */
  stepInterval?: number;

  /**
   * Size step of the component: -2 very small, -1 small, 0 default, 1 large, 2 very large.
   * Omitted inherits `--ohne-size` from the nearest ancestor.
   */
  size?: number;

  /**
   * Extra class names appended to the container's own.
   */
  class?: string;

  /**
   * Called once immediately and then every `stepInterval` while a scroll button is hovered.
   */
  onScrollStep?: (direction: 'up' | 'down') => void;

  /**
   * Receives the live handle at construction.
   */
  expose?: (handle: ScrollableHandle) => void;
}

css`
  .ohne-scrollable {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow-y: auto;
    scrollbar-width: none;
    font-size: calc(1rem + var(--ohne-size) * 0.125rem);
    line-height: 1.25;
  }

  .ohne-scrollable-button {
    flex-shrink: 0;
    position: sticky;
    z-index: 11;
    display: flex;
    justify-content: center;
    align-items: center;
    height: 0;
    overflow: hidden;
    cursor: default;
    background-color: hsl(var(--ohne-background));
    color: hsl(var(--ohne-foreground));
  }

  .ohne-scrollable:not(.ohne-scrollable-is-animating) .ohne-scrollable-button {
    transition: var(--ohne-transition);
    transition-property: transform;
  }

  .ohne-scrollable-button:first-child {
    top: 0;
    transform: translateY(-100%);
  }

  .ohne-scrollable-button:last-child {
    bottom: 0;
    transform: translateY(100%);
  }

  .ohne-scrollable-button-visible:first-child,
  .ohne-scrollable-button-visible:last-child {
    height: 1em;
    transform: translate3d(0, 0, 0);
  }

  .ohne-scrollable-content {
    flex: 1;
  }

  .ohne-scrollable-content-not-top {
    margin-top: -1em;
  }

  .ohne-scrollable-content-not-bottom {
    margin-bottom: -1em;
  }
`;

/**
 * A vertical scroll container with a hidden scrollbar and sticky hover-to-scroll edge buttons.
 * The chevrons double as scroll-position indicators: each shows only while its edge is unreached.
 * Negative content margins absorb the button heights.
 * Visibility flips then never change the scroll height.
 * Edge reveals animate; container resizes snap without transition.
 *
 * @example
 * ```ts
 * scrollable(list, { autoScroll: 32 })
 * ```
 */
export function scrollable(
  content?: Child | (() => Child),
  options: ScrollableOptions = {},
): HTMLElement {
  const y = ref(0);
  const arrivedTop = ref(true);
  const arrivedBottom = ref(false);
  const isTopButtonVisible = ref(false);
  const isBottomButtonVisible = ref(false);
  const isLocked = ref(false);
  const isAnimating = ref(false);

  let scrollInterval: ReturnType<typeof setInterval> | undefined;
  let lastHeight = 0;

  const measure = (): void => {
    arrivedTop.value = root.scrollTop <= 0;
    arrivedBottom.value = root.scrollTop + root.clientHeight >= root.scrollHeight - 1;
  };

  const update = (): void => {
    measure();
    isTopButtonVisible.value = !arrivedTop.value;
    isBottomButtonVisible.value = !arrivedBottom.value;
    isAnimating.value = false;
  };

  const updateDebounced = debounce(update, 30);

  const startStepScroll = (direction: 'up' | 'down'): void => {
    options.onScrollStep?.(direction);
    autoScroll(direction);
    scrollInterval = setInterval(() => {
      options.onScrollStep?.(direction);
      autoScroll(direction);
    }, options.stepInterval ?? 50);
  };

  const stopStepScroll = (): void => {
    clearInterval(scrollInterval);
  };

  const autoScroll = (direction: 'up' | 'down'): void => {
    const step = options.autoScroll ?? 0;
    if (step) {
      root.scrollTo({
        top: root.scrollTop + (direction === 'up' ? -step : step),
        behavior: 'instant',
      });
    }
  };

  const edgeButton = (direction: 'up' | 'down', visible: Ref<boolean>): HTMLElement =>
    h(
      'div',
      {
        class: () =>
          'ohne-scrollable-button' + (visible.value ? ' ohne-scrollable-button-visible' : ''),
        onMouseenter: (event: MouseEvent) => {
          const capabilities = (
            event as MouseEvent & { sourceCapabilities?: { firesTouchEvents?: boolean } }
          ).sourceCapabilities;
          if (!capabilities?.firesTouchEvents) startStepScroll(direction);
        },
        onMouseleave: () => stopStepScroll(),
        onDragenter: (event: DragEvent) => {
          event.preventDefault();
          startStepScroll(direction);
        },
        onDragleave: () => stopStepScroll(),
        onDragover: (event: DragEvent) => event.preventDefault(),
      },
      icon(direction === 'up' ? 'chevron-up' : 'chevron-down'),
    );

  const root = h(
    'div',
    {
      class: () =>
        'ohne-scrollable' +
        (isAnimating.value ? ' ohne-scrollable-is-animating' : '') +
        (options.class ? ` ${options.class}` : ''),
      style: options.size === undefined ? undefined : `--ohne-size: ${options.size}`,
      onWheel: () => stopStepScroll(),
      onScroll: () => {
        y.value = root.scrollTop;
        measure();
      },
    },
    edgeButton('up', isTopButtonVisible),
    h(
      'div',
      {
        class: () =>
          'ohne-scrollable-content' +
          (isTopButtonVisible.value ? ' ohne-scrollable-content-not-top' : '') +
          (isBottomButtonVisible.value ? ' ohne-scrollable-content-not-bottom' : ''),
      },
      content,
    ),
    edgeButton('down', isBottomButtonVisible),
  );

  effect(() => {
    const top = y.value;
    if (root.scrollTop !== top) root.scrollTo({ top, behavior: 'instant' });
  });

  effect(() => {
    void arrivedTop.value;
    void arrivedBottom.value;
    update();
  });

  effect(() => {
    if (isLocked.value) root.style.overflow = 'hidden';
    else root.style.removeProperty('overflow');
  });

  const observer = new ResizeObserver((entries) => {
    const height = entries[entries.length - 1]?.contentRect.height ?? 0;
    if (height === lastHeight) return;
    lastHeight = height;
    isTopButtonVisible.value = false;
    isBottomButtonVisible.value = false;
    isAnimating.value = true;
    updateDebounced();
  });
  observer.observe(root);

  onCleanup(() => {
    stopStepScroll();
    updateDebounced.cancel();
    observer.disconnect();
  });

  options.expose?.({
    y,
    arrivedTop,
    arrivedBottom,
    isTopButtonVisible,
    isBottomButtonVisible,
    isLocked,
    measure,
  });

  return root;
}
