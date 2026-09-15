import type { Child } from '../render/insert.ts';
import type { Placement } from './floater-place.ts';

import { isString } from '../../utils/is/is-string.ts';
import { isUndefined } from '../../utils/is/is-undefined.ts';
import { onCleanup } from '../../utils/reactive/effect-scope.ts';
import { ref } from '../../utils/reactive/ref.ts';
import { css } from '../render/css.ts';
import { h } from '../render/h.ts';
import { placeFloating } from './floater-place.ts';
import { placeFixed, raiseToTopLayer } from './overlay.ts';
import { type ScrollableHandle, type ScrollableOptions, scrollable } from './scrollable.ts';
import './tokens.ts';

/**
 * A data shape for consumers building nested dropdown menus.
 * The component itself does not consume it.
 */
export interface DropdownItemModel {
  /**
   * The text displayed for the dropdown item.
   */
  label: string;

  /**
   * Optional array of nested dropdown items.
   * When provided, describes a hierarchical dropdown menu.
   */
  choices?: DropdownItemModel[];
}

/**
 * The pixel sizes `calcItemSizes` measures for a dropdown.
 */
export interface DropdownItemSizes {
  /**
   * The document root's computed font size in pixels.
   */
  baseFontSize: number;

  /**
   * One `em` at the dropdown's effective `--ohne-size`, in pixels.
   */
  em: number;

  /**
   * The height of one dropdown item row in pixels, `2 * em`.
   */
  itemHeight: number;
}

/**
 * Options for `dropdown`.
 */
export interface DropdownOptions {
  /**
   * The anchor element the floating panel positions against.
   * Omitted, the panel stays at its initial coordinates.
   */
  reference?: HTMLElement;

  /**
   * Which side of the `reference` the panel prefers.
   * The roomiest corner placement that fits wins, else the roomiest; earlier candidates break ties.
   *
   * @default
   * 'start'
   */
  placement?: 'start' | 'end';

  /**
   * The gap between the panel and its `reference` in pixels.
   *
   * @default
   * 4
   */
  offset?: number;

  /**
   * Where focus goes when the dropdown unmounts.
   * `true` refocuses the element focused before opening; `false` restores nothing.
   * An `HTMLElement` is focused directly; a string focuses the first match of the CSS selector.
   *
   * @default
   * true
   */
  restoreFocus?: boolean | string | HTMLElement;

  /**
   * Whether the dropdown takes control of keyboard and mouse events while mounted.
   * While on, the body gets `ohne-no-interaction` and arrows and Tab rove focus through the rows.
   * Outside clicks or Escape call `onClose`.
   * The chips field passes `false` and keeps keyboard control in its text input.
   *
   * @default
   * true
   */
  handleControls?: boolean;

  /**
   * Adjusts the size of the component, from -2 (very small) to 2 (very large).
   * Omitted, the value is inherited as `--ohne-size` from the parent element.
   */
  size?: number;

  /**
   * Keeps the surrounding color scheme instead of the primary panel colors.
   *
   * @default
   * false
   */
  inheritColors?: boolean;

  /**
   * Extra class names appended to the panel's own.
   */
  class?: string;

  /**
   * Called when the dropdown wants to close.
   * The owner unmounts it; the component never hides itself.
   */
  onClose?: () => void;
}

/**
 * A mounted dropdown: the panel element plus the surface it exposes.
 */
export interface DropdownHandle {
  /**
   * The floating panel element to insert into the tree.
   */
  root: HTMLElement;

  /**
   * Recomputes the panel position; call after content changes move the anchor.
   */
  update(): void;

  /**
   * Measures the current base font size, `em` unit, and item row height in pixels.
   */
  calcItemSizes(): DropdownItemSizes;

  /**
   * The scroll surface of the panel's `scrollable`.
   */
  scrollable: ScrollableHandle;
}

const containers = new WeakMap<Element, () => HTMLElement | null>();

/**
 * Resolves the hosting container of the dropdown an element sits in.
 * Under `handleControls` it is the nearest `.ohne-popup` ancestor or `<body>`.
 * Otherwise it is the panel's direct parent, and `null` outside any dropdown.
 * `dropdownItem` refocuses it on mouseleave to keep keyboard context inside a hosting popup.
 */
export function dropdownContainerOf(el: Element): HTMLElement | null {
  const root = el.closest('.ohne-dropdown');
  return root ? (containers.get(root)?.() ?? null) : null;
}

css`
  .ohne-dropdown {
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
 * The floating panel primitive.
 *
 * A primary-colored panel anchored to `reference`: the roomiest of the four corner placements wins.
 * The height clamps to the available space with an 8px inset.
 * The panel is raised to the top layer, so a `container-type` or transformed ancestor cannot crop it.
 * With `handleControls` on, the page loses pointer events.
 * Focus roves through `.ohne-dropdown-item` rows with wraparound.
 * Escape or an outside click asks the owner to close.
 *
 * @example
 * ```ts
 * const menu = dropdown([dropdownItem('Rename'), dropdownItem('Delete', { destructive: true })], {
 *   reference: button,
 *   onClose: () => (open.value = false),
 * })
 * parent.append(menu.root)
 * ```
 */
export function dropdown(
  content: Child | (() => Child),
  options: DropdownOptions = {},
): DropdownHandle {
  const handleControls = options.handleControls ?? true;
  const alignment = options.placement ?? 'start';
  const allowedPlacements: Placement[] =
    alignment === 'end'
      ? ['bottom-end', 'bottom-start', 'top-end', 'top-start']
      : ['bottom-start', 'bottom-end', 'top-start', 'top-end'];
  const isMounted = ref(false);
  const placement = ref<Placement>(alignment === 'end' ? 'bottom-end' : 'bottom-start');
  const stops: (() => void)[] = [];

  let scroll!: ScrollableHandle;
  let parentContainer: HTMLElement | null = null;
  let prevFocus: HTMLElement | null = null;
  let disposed = false;

  const scrollableOptions: ScrollableOptions = {
    autoScroll: 0,
    class: 'ohne-dropdown-scrollable',
    expose: (handle) => {
      scroll = handle;
    },
  };

  const inner = h('div', { class: 'ohne-dropdown-inner' }, content);

  const root = h(
    'div',
    {
      tabindex: '-1',
      class: () =>
        `ohne-dropdown ohne-dropdown-${placement.value}` +
        (isMounted.value ? ' ohne-dropdown-mounted' : '') +
        (options.class ? ` ${options.class}` : ''),
      style:
        'position: fixed; left: 0; top: 0;' +
        (isUndefined(options.size) ? '' : ` --ohne-size: ${options.size};`) +
        (options.inheritColors
          ? ''
          : ' --ohne-background: var(--ohne-primary); --ohne-foreground: var(--ohne-primary-foreground);'),
      onKeydown: (event: KeyboardEvent) => {
        if (event.key === ' ') event.preventDefault();
      },
    },
    scrollable(inner, scrollableOptions),
  );

  const calcItemSizes = (): DropdownItemSizes => {
    const baseFontSize = +getComputedStyle(document.documentElement)
      .getPropertyValue('font-size')
      .slice(0, -2);
    const sizeVar = getComputedStyle(root).getPropertyValue('--ohne-size');
    const size = sizeVar ? +sizeVar : 0;
    const em = baseFontSize + size * 0.125 * baseFontSize;
    return { baseFontSize, em, itemHeight: 2 * em };
  };

  const update = (): void => {
    const reference = options.reference;
    if (!reference) return;
    const rect = reference.getBoundingClientRect();
    const input = {
      reference: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      viewport: {
        width: document.documentElement.clientWidth,
        height: document.documentElement.clientHeight,
      },
      allowedPlacements,
      offset: options.offset ?? 4,
      shiftPadding: 0,
      sizePadding: 8,
    };
    const measured = placeFloating({
      ...input,
      floating: { width: root.offsetWidth, height: root.offsetHeight },
    });
    if (measured.availableHeight < inner.scrollHeight) {
      root.style.height = `${Math.max(0, measured.availableHeight)}px`;
    } else {
      root.style.removeProperty('height');
    }
    const placed = placeFloating({
      ...input,
      floating: { width: root.offsetWidth, height: root.offsetHeight },
    });
    placeFixed(root, placed.x, placed.y);
    placement.value = placed.placement;
  };

  const focusPrevious = (): void => {
    const items = [...root.querySelectorAll<HTMLElement>('.ohne-dropdown-item')];
    const index = items.findIndex((item) => item === document.activeElement);
    (items[index - 1] ?? items[items.length - 1])?.focus();
  };

  const focusNext = (): void => {
    const items = [...root.querySelectorAll<HTMLElement>('.ohne-dropdown-item')];
    const index = items.findIndex((item) => item === document.activeElement);
    (items[index + 1] ?? items[0])?.focus();
  };

  containers.set(root, () => parentContainer);

  const observer = new ResizeObserver(update);
  observer.observe(root);
  if (options.reference) observer.observe(options.reference);
  window.addEventListener('scroll', update, { capture: true, passive: true });
  window.addEventListener('resize', update);

  queueMicrotask(() => {
    if (disposed) return;
    prevFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    parentContainer = root.parentElement;
    raiseToTopLayer(root);
    update();

    if (handleControls) {
      document.body.classList.add('ohne-no-interaction');
      setTimeout(() => root.focus());

      while (
        parentContainer &&
        parentContainer.nodeName !== 'BODY' &&
        !parentContainer.classList.contains('ohne-popup')
      ) {
        parentContainer = parentContainer.parentElement;
      }
      parentContainer?.classList.add('ohne-allow-interaction');

      setTimeout(() => {
        const container = parentContainer;
        if (disposed || !container) return;
        const onKeydown = (event: KeyboardEvent): void => {
          if (!['Enter', 'NumpadEnter', 'Escape', 'Space'].includes(event.code)) {
            event.preventDefault();
            event.stopPropagation();
          }
          if (event.code === 'ArrowUp') {
            focusPrevious();
          } else if (event.code === 'ArrowDown') {
            focusNext();
          } else if (event.code === 'Tab') {
            if (event.shiftKey) focusPrevious();
            else focusNext();
          } else if (event.code === 'Escape') {
            if (container.nodeName !== 'BODY') {
              event.preventDefault();
              event.stopPropagation();
            }
            options.onClose?.();
          }
        };
        const onPress = (event: MouseEvent): void => {
          // Strict descendants only: a click on the panel itself, outside any row, closes the dropdown.
          const inside =
            event.target instanceof HTMLElement &&
            event.target !== root &&
            root.contains(event.target);
          if (event.target instanceof HTMLElement && !inside) options.onClose?.();
        };
        container.addEventListener('keydown', onKeydown);
        container.addEventListener('click', onPress);
        container.addEventListener('contextmenu', onPress);
        stops.push(
          () => container.removeEventListener('keydown', onKeydown),
          () => container.removeEventListener('click', onPress),
          () => container.removeEventListener('contextmenu', onPress),
        );
      });
    }

    setTimeout(() => {
      isMounted.value = true;
    });

    scrollableOptions.autoScroll = calcItemSizes().itemHeight;
  });

  onCleanup(() => {
    disposed = true;
    observer.disconnect();
    window.removeEventListener('scroll', update, { capture: true });
    window.removeEventListener('resize', update);
    if (handleControls) {
      document.body.classList.remove('ohne-no-interaction');
      parentContainer?.classList.remove('ohne-allow-interaction');
    }
    for (const stop of stops) stop();
    stops.length = 0;
    const restore = options.restoreFocus ?? true;
    if (restore) {
      setTimeout(() => {
        if (restore instanceof HTMLElement) {
          restore.focus();
        } else if (isString(restore)) {
          document.querySelector<HTMLElement>(restore)?.focus();
        } else {
          prevFocus?.focus();
        }
        if (
          document.activeElement?.nodeName === 'BODY' &&
          parentContainer &&
          parentContainer.nodeName !== 'BODY'
        ) {
          parentContainer.focus();
        }
      });
    }
  });

  return { root, update, calcItemSizes, scrollable: scroll };
}
