import type { Ref } from '../../utils/reactive/ref.ts';
import type { Child } from '../render/insert.ts';
import type { Placement } from './floater-place.ts';

import { last } from '../../utils/array/last.ts';
import { isUndefined } from '../../utils/is/is-undefined.ts';
import { onCleanup } from '../../utils/reactive/effect-scope.ts';
import { ref } from '../../utils/reactive/ref.ts';
import { css } from '../render/css.ts';
import { h } from '../render/h.ts';
import { when } from '../render/when.ts';
import { placeFloating } from './floater-place.ts';
import { placeFixed } from './overlay.ts';
import { scrollable } from './scrollable.ts';
import './tokens.ts';

/**
 * Options for `contextMenu`.
 */
export interface ContextMenuOptions {
  /**
   * The duration in milliseconds a touch must hold to trigger the context menu.
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
}

/**
 * A mounted context menu: the root element plus the trigger surface the consumer wires up.
 */
export interface ContextMenu {
  /**
   * The root element to insert into the tree.
   */
  root: HTMLElement;

  /**
   * Bind to the trigger area's `contextmenu` event.
   * Suppresses the native menu and opens this one at the pointer.
   */
  onContextMenu(event: MouseEvent): void;

  /**
   * Bind to the trigger area's `touchstart` event; a hold of `touchDuration` opens the menu.
   */
  onTouchStart(event: TouchEvent): void;

  /**
   * Bind to the trigger area's `touchend` event.
   * Cancels a pending hold and clears the text selection the long-press created.
   */
  onTouchEnd(): void;
}

const ALLOWED_PLACEMENTS: Placement[] = ['bottom-start', 'bottom-end', 'top-start', 'top-end'];

css`
  .ohne-context-menu-floating {
    position: fixed;
  }

  .ohne-dropdown {
    z-index: 99997;
    display: flex;
    flex-direction: column;
    width: 15em;
    max-width: 100%;
    outline: none;
    font-size: calc(1rem + var(--ohne-size) * 0.125rem);
  }

  .ohne-no-interaction .ohne-dropdown,
  .ohne-no-interaction .ohne-dropdown * {
    pointer-events: all !important;
  }

  .ohne-dropdown-scrollable {
    background-color: hsl(var(--ohne-background));
    border-radius: calc(var(--ohne-radius) - 0.125rem);
    box-shadow: var(--ohne-shadow);
    color: hsl(var(--ohne-foreground));
  }

  .ohne-dropdown-mounted .ohne-dropdown-scrollable {
    transition: var(--ohne-transition);
    transition-property: opacity, transform;
  }

  .ohne-dropdown:not(.ohne-dropdown-mounted) .ohne-dropdown-scrollable {
    opacity: 0;
    transform: translate3d(0, -0.5rem, 0) scale(0.95);
  }

  .ohne-dropdown-top-start:not(.ohne-dropdown-mounted) .ohne-dropdown-scrollable,
  .ohne-dropdown-top-end:not(.ohne-dropdown-mounted) .ohne-dropdown-scrollable {
    transform: translate3d(0, 0.5rem, 0) scale(0.95);
  }

  .ohne-dropdown-inner {
    padding: 0.25rem;
  }

  .ohne-dropdown-inner > hr {
    width: calc(100% + 0.5rem);
    margin: 0.25rem -0.25rem;
    height: 1px;
    background-color: hsl(var(--ohne-card) / 0.16);
    border: none;
  }

  .ohne-dropdown-inner > hr + hr,
  .ohne-dropdown-inner > hr:first-child,
  .ohne-dropdown-inner > hr:last-child {
    display: none;
  }
`;

/**
 * The right-click and long-press menu, ported 1-to-1 from Pruvious v4's `PUIContextMenu`.
 *
 * An invisible fixed anchor parks at the trigger event's pointer coordinates.
 * While `event` holds one, a dropdown mounts on it: the roomiest corner wins, clamped to the viewport.
 * While open, the page loses pointer events outside the menu's host (`.ohne-popup` ancestor or `body`).
 * Arrows and Tab cycle the focus through `.ohne-dropdown-item` elements.
 * Escape closes without closing a hosting popup, and any outside press closes.
 * A second right-click closes too; its new coordinates land only on the third.
 * Item clicks close nothing by themselves: the consumer usually nulls `event` on click.
 * Closing restores focus to the previously focused element.
 *
 * @example
 * ```ts
 * const event = ref<MouseEvent | TouchEvent | null>(null)
 * const menu = contextMenu(event, [item1, h('hr'), item2])
 *
 * h('div', { onContextmenu: (e: MouseEvent) => menu.onContextMenu(e) }, target, menu.root)
 * ```
 */
export function contextMenu(
  event: Ref<MouseEvent | TouchEvent | null>,
  content: Child | (() => Child),
  options: ContextMenuOptions = {},
): ContextMenu {
  const anchor = h('div', {
    class: 'ohne-context-menu-floating',
    style: () => {
      const current = event.value;
      const top =
        current && 'clientY' in current ? current.clientY : (current?.touches[0]?.clientY ?? 0);
      const left =
        current && 'clientY' in current ? current.clientX : (current?.touches[0]?.clientX ?? 0);
      return `top: ${top}px; left: ${left}px;`;
    },
  });

  const close = (): void => {
    event.value = null;
  };

  const itemHeight = (): number => {
    const base = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
    const inherited = Number(getComputedStyle(root).getPropertyValue('--ohne-size')) || 0;
    const size = options.size ?? inherited;
    return 2 * (base + size * 0.125 * base);
  };

  const buildDropdown = (): Child => {
    const placement = ref<Placement>('bottom-start');
    const isMounted = ref(false);
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    let host: HTMLElement | null = null;

    const inner = h('div', { class: 'ohne-dropdown-inner' }, content);
    const panel = scrollable(inner, {
      autoScroll: itemHeight(),
      class: 'ohne-dropdown-scrollable',
    });
    const floating = h(
      'div',
      {
        tabindex: '-1',
        class: () =>
          'ohne-dropdown' +
          (isMounted.value ? ' ohne-dropdown-mounted' : '') +
          ` ohne-dropdown-${placement.value}`,
        style:
          'position: fixed; left: 0; top: 0;' +
          (isUndefined(options.size) ? '' : ` --ohne-size: ${options.size};`) +
          ' --ohne-background: var(--ohne-primary);' +
          ' --ohne-foreground: var(--ohne-primary-foreground);',
        onKeydown: (keyboard: KeyboardEvent) => {
          if (keyboard.key === ' ') keyboard.preventDefault();
        },
      },
      panel,
    );

    const update = (): void => {
      const rect = anchor.getBoundingClientRect();
      const input = {
        reference: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        viewport: {
          width: document.documentElement.clientWidth,
          height: document.documentElement.clientHeight,
        },
        allowedPlacements: ALLOWED_PLACEMENTS,
        offset: 0,
        shiftPadding: 0,
        sizePadding: 8,
      };
      let placed = placeFloating({
        ...input,
        floating: { width: floating.offsetWidth, height: floating.offsetHeight },
      });
      if (placed.availableHeight < inner.scrollHeight) {
        floating.style.height = `${Math.max(0, placed.availableHeight)}px`;
      } else {
        floating.style.removeProperty('height');
      }
      placed = placeFloating({
        ...input,
        floating: { width: floating.offsetWidth, height: floating.offsetHeight },
      });
      placeFixed(floating, placed.x, placed.y);
      placement.value = placed.placement;
    };

    const items = (): HTMLElement[] => [
      ...floating.querySelectorAll<HTMLElement>('.ohne-dropdown-item'),
    ];

    const focusPrevious = (): void => {
      const order = items();
      const index = order.findIndex((item) => item === document.activeElement);
      (order[index - 1] ?? last(order))?.focus();
    };

    const focusNext = (): void => {
      const order = items();
      const index = order.findIndex((item) => item === document.activeElement);
      (order[index + 1] ?? order[0])?.focus();
    };

    const onHostKeydown = (keyboard: KeyboardEvent): void => {
      if (!['Enter', 'NumpadEnter', 'Escape', 'Space'].includes(keyboard.code)) {
        keyboard.preventDefault();
        keyboard.stopPropagation();
      }
      if (keyboard.code === 'ArrowUp') {
        focusPrevious();
      } else if (keyboard.code === 'ArrowDown') {
        focusNext();
      } else if (keyboard.code === 'Tab') {
        if (keyboard.shiftKey) focusPrevious();
        else focusNext();
      } else if (keyboard.code === 'Escape') {
        if (host && host.nodeName !== 'BODY') {
          keyboard.preventDefault();
          keyboard.stopPropagation();
        }
        close();
      }
    };

    const onHostPress = (press: Event): void => {
      if (press.target instanceof HTMLElement && !floating.contains(press.target)) close();
    };

    const stops: (() => void)[] = [];
    let disposed = false;
    const observer = new ResizeObserver(update);
    observer.observe(anchor);
    observer.observe(floating);
    window.addEventListener('scroll', update, { capture: true, passive: true });
    window.addEventListener('resize', update);
    stops.push(() => {
      observer.disconnect();
      window.removeEventListener('scroll', update, { capture: true });
      window.removeEventListener('resize', update);
    });

    queueMicrotask(() => {
      if (disposed) return;
      document.body.classList.add('ohne-no-interaction');
      setTimeout(() => floating.focus());
      let parent = floating.parentElement;
      while (parent && parent.nodeName !== 'BODY' && !parent.classList.contains('ohne-popup')) {
        parent = parent.parentElement;
      }
      host = parent;
      host?.classList.add('ohne-allow-interaction');
      setTimeout(() => {
        const target = host;
        if (disposed || !target) return;
        target.addEventListener('keydown', onHostKeydown);
        target.addEventListener('click', onHostPress);
        target.addEventListener('contextmenu', onHostPress);
        stops.push(() => {
          target.removeEventListener('keydown', onHostKeydown);
          target.removeEventListener('click', onHostPress);
          target.removeEventListener('contextmenu', onHostPress);
        });
      });
      update();
    });

    setTimeout(() => {
      isMounted.value = true;
    });

    onCleanup(() => {
      disposed = true;
      document.body.classList.remove('ohne-no-interaction');
      host?.classList.remove('ohne-allow-interaction');
      for (const stop of stops) stop();
      setTimeout(() => {
        previous?.focus();
        if (document.activeElement?.nodeName === 'BODY' && host && host.nodeName !== 'BODY') {
          host.focus();
        }
      });
    });

    return floating;
  };

  const root = h(
    'div',
    { class: 'ohne-context-menu' },
    anchor,
    when(() => event.value, buildDropdown),
  );

  let touchTimeout: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(touchTimeout));

  return {
    root,
    onContextMenu: (trigger) => {
      trigger.preventDefault();
      event.value = trigger;
    },
    onTouchStart: (trigger) => {
      touchTimeout = setTimeout(() => {
        event.value = trigger;
      }, options.touchDuration ?? 500);
    },
    onTouchEnd: () => {
      clearTimeout(touchTimeout);
      if (event.value) {
        setTimeout(() => window.getSelection()?.removeAllRanges(), 50);
      }
    },
  };
}
