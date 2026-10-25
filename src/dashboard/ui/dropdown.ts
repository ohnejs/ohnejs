import type { Child } from '../render/insert.ts';
import type { Placement, Rect, ScreenPoint } from './floater-place.ts';

import { first } from '../../utils/array/first.ts';
import { last } from '../../utils/array/last.ts';
import { isEmpty } from '../../utils/is/is-empty.ts';
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
   * The anchor the floating panel positions against: an element, or a viewport point.
   * A point anchors a zero-size rect, so the panel opens with its corner at the pointer, as under `firstFit`.
   * Omitted, the panel stays at its initial coordinates.
   */
  reference?: HTMLElement | ScreenPoint;

  /**
   * Which side of the `reference` the panel prefers.
   * The roomiest corner placement that fits wins, else the roomiest; earlier candidates break ties.
   *
   * @default
   * 'start'
   */
  placement?: 'start' | 'end';

  /**
   * Takes the first corner that fits, below before above, instead of the roomiest one.
   *
   * @default
   * false
   */
  firstFit?: boolean;

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
   * Focus that something outside the panel took meanwhile, like a picked action's, is never taken back.
   * Focus resting on the hosting popup itself does not count, so it still moves on.
   * An `HTMLElement` is focused directly; a string focuses the first match of the CSS selector.
   *
   * @default
   * true
   */
  restoreFocus?: boolean | string | HTMLElement;

  /**
   * Whether opening focuses the first enabled row instead of the panel.
   * Pass it when the keyboard opened the dropdown; a pointer open keeps every row unhighlighted.
   * Without an enabled row, the panel takes focus.
   *
   * @default
   * false
   */
  focusFirstRow?: boolean;

  /**
   * Whether the dropdown takes control of keyboard and mouse events while mounted.
   * While on, the body gets `ohne-no-interaction` and arrows and Tab rove focus through the rows.
   * Home and End jump to the first and the last row.
   * Outside clicks, right-clicks, or Escape call `onClose`.
   * The chips field passes `false` and keeps keyboard control in its text input.
   *
   * @default
   * true
   */
  handleControls?: boolean;

  /**
   * Adjusts the size of the component, from -2 (very small) to 2 (very large).
   * Omitted, the panel takes the `--ohne-size` around an element `reference`, even when mounted on the body.
   * The trigger's own size is left out, so a compact icon button still opens a readable menu.
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

  .ohne-no-interaction .ohne-dropdown {
    pointer-events: auto;
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
`;

/**
 * The floating panel primitive.
 *
 * A primary-colored panel anchored to `reference`: the roomiest of the four corner placements wins.
 * A point `reference` or `firstFit` takes the first corner that fits instead.
 * The height clamps to the available space with an 8px inset.
 * The panel is raised to the top layer, so a `container-type` or transformed ancestor cannot crop it.
 * With `handleControls` on, the page loses pointer events.
 * Focus roves through `.ohne-dropdown-item` rows with wraparound, and Home and End reach either end.
 * Escape or an outside click asks the owner to close.
 * An outside right-click closes without the browser's menu.
 * A right-click inside the panel does nothing, and never reaches the element that hosts the panel.
 * The closing Escape is marked handled, so `useHotkeys` skips it.
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
  const element = options.reference instanceof HTMLElement ? options.reference : undefined;
  const size = options.size ?? referenceSize(element);
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
        (isUndefined(size) ? '' : ` --ohne-size: ${size};`) +
        (options.inheritColors
          ? ''
          : ' --ohne-background: var(--ohne-primary); --ohne-foreground: var(--ohne-primary-foreground);'),
      onKeydown: (event: KeyboardEvent) => {
        if (event.key === ' ') event.preventDefault();
      },
      // The panel stays in its host's tree, so a host's context menu or row handler would take it.
      onContextmenu: (event: MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
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
    const reference = referenceRect(options.reference);
    if (!reference) return;
    const input = {
      reference,
      viewport: {
        width: document.documentElement.clientWidth,
        height: document.documentElement.clientHeight,
      },
      allowedPlacements,
      firstFit: options.firstFit || isUndefined(element),
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

  const rows = (): HTMLElement[] => [...root.querySelectorAll<HTMLElement>('.ohne-dropdown-item')];

  const focusPrevious = (): void => {
    const items = rows();
    const index = items.findIndex((item) => item === document.activeElement);
    (items[index - 1] ?? items[items.length - 1])?.focus();
  };

  const focusNext = (): void => {
    const items = rows();
    const index = items.findIndex((item) => item === document.activeElement);
    (items[index + 1] ?? items[0])?.focus();
  };

  const focusOnOpen = (): void => {
    const first = options.focusFirstRow
      ? rows().find((row) => row.getAttribute('aria-disabled') !== 'true')
      : undefined;
    (first ?? root).focus();
  };

  containers.set(root, () => parentContainer);

  const observer = new ResizeObserver(update);
  observer.observe(root);
  if (element) observer.observe(element);
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
      setTimeout(focusOnOpen);

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
          } else if (event.code === 'Home') {
            first(rows())?.focus();
          } else if (event.code === 'End') {
            last(rows())?.focus();
          } else if (event.code === 'Escape') {
            event.preventDefault();
            if (container.nodeName !== 'BODY') event.stopPropagation();
            options.onClose?.();
          }
        };
        const onPress = (event: MouseEvent): void => {
          // Strict descendants only: a click on the panel itself, outside any row, closes the dropdown.
          const hit = event.target;
          if (!(hit instanceof HTMLElement) || (hit !== root && root.contains(hit))) return;
          if (event.type === 'contextmenu') event.preventDefault();
          options.onClose?.();
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
        const active = document.activeElement;
        // A picked action runs before this timer, and the focus it hands on wins.
        const handedOn = active !== document.body && active !== parentContainer;
        if (active instanceof HTMLElement && handedOn && active.isConnected) return;
        // Handing focus back must not scroll: a right-click focuses the target, however tall it is.
        const back = { preventScroll: true };
        if (restore instanceof HTMLElement) {
          restore.focus(back);
        } else if (isString(restore)) {
          document.querySelector<HTMLElement>(restore)?.focus(back);
        } else {
          prevFocus?.focus(back);
        }
        if (
          document.activeElement?.nodeName === 'BODY' &&
          parentContainer &&
          parentContainer.nodeName !== 'BODY'
        ) {
          parentContainer.focus(back);
        }
      });
    }
  });

  return { root, update, calcItemSizes, scrollable: scroll };
}

/**
 * The viewport rect of `reference`, a zero-size one at a point, or `undefined` without one.
 */
function referenceRect(reference: HTMLElement | ScreenPoint | undefined): Rect | undefined {
  if (isUndefined(reference)) return undefined;
  if (!(reference instanceof HTMLElement)) {
    return { x: reference.clientX, y: reference.clientY, width: 0, height: 0 };
  }
  const { x, y, width, height } = reference.getBoundingClientRect();
  return { x, y, width, height };
}

/**
 * The `--ohne-size` in effect around `reference`, read from its parent, or `undefined` without one.
 * The parent leaves out the reference's own size, so a compact trigger still opens a readable panel.
 */
export function referenceSize(reference: HTMLElement | undefined): number | undefined {
  const context = reference?.parentElement;
  const size = context ? getComputedStyle(context).getPropertyValue('--ohne-size').trim() : '';
  return isEmpty(size) ? undefined : Number(size);
}
