import type { Ref } from '../../utils/reactive/ref.ts';
import type { Child } from '../render/insert.ts';
import type { Placement } from './floater-place.ts';

import { last } from '../../utils/array/last.ts';
import { isUndefined } from '../../utils/is/is-undefined.ts';
import { onCleanup } from '../../utils/reactive/effect-scope.ts';
import { nextTick } from '../../utils/reactive/next-tick.ts';
import { ref } from '../../utils/reactive/ref.ts';
import { untracked } from '../../utils/reactive/untracked.ts';
import { sleep } from '../../utils/sleep/sleep.ts';
import { css } from '../render/css.ts';
import { h } from '../render/h.ts';
import { when } from '../render/when.ts';
import { placeFloating } from './floater-place.ts';
import { FOCUSABLE, lockScroll, listenClickOutside } from './overlay.ts';
import './tokens.ts';

/**
 * Options for `floater`.
 */
export interface FloaterOptions {
  /**
   * The handle button's content.
   */
  handle?: Child | (() => Child);

  /**
   * Rendered after the floating element inside the root.
   * Pickers put a hidden form input here for form association.
   */
  after?: Child | (() => Child);

  /**
   * Adjusts the size of the component, from -2 (very small) to 2 (very large).
   * Set as the inline `--ohne-size` on the root and the floating element.
   * Omitted, the value is inherited from the parent element.
   */
  size?: number;

  /**
   * Whether the input has errors, rendered as the destructive ring and border.
   */
  error?: () => boolean;

  /**
   * Whether the input is disabled: the handle leaves the tab order and clicks are no-ops.
   */
  disabled?: () => boolean;

  /**
   * Text for the `title` attribute of the handle.
   */
  handleTitle?: string;

  /**
   * The CSS position of the floating element.
   * `'fixed'` is right for most cases.
   * `'absolute'` positions relative to the offset parent, useful inside a scrolling container.
   *
   * @default
   * 'fixed'
   */
  strategy?: 'fixed' | 'absolute';

  /**
   * A scrollable ancestor locked alongside the window while the floater is open.
   */
  scrollContainer?: HTMLElement;

  /**
   * Handles Escape while open INSTEAD of the default close.
   * The default prevents the event, stops other listeners, closes, and refocuses the handle.
   * A calendar uses this to dismiss its sub-selectors first, closing only on a second Escape.
   */
  onEscapeKey?: (event: KeyboardEvent) => void;

  /**
   * Called when the floater starts opening.
   */
  onOpen?: () => void;

  /**
   * Called when the floater starts closing.
   */
  onClose?: () => void;

  /**
   * Called for every key pressed while open, except Escape.
   * Fires in the capture phase, ahead of inner element handlers.
   */
  onKeydown?: (event: KeyboardEvent) => void;

  /**
   * Called when the handle button loses focus.
   */
  onBlurHandle?: () => void;
}

/**
 * A mounted floater: the root element plus its open/close surface.
 */
export interface Floater {
  /**
   * The root element to insert into the tree.
   */
  root: HTMLElement;

  /**
   * The handle button.
   */
  handle: HTMLButtonElement;

  /**
   * The panel element, or `null` while closed - it exists fresh per open.
   */
  container(): HTMLElement | null;

  /**
   * Opens the floater; a no-op while already open.
   * Resolves once the open choreography finished.
   */
  open(event?: Event): Promise<void>;

  /**
   * Closes the floater; a no-op while already closed.
   * Resolves after the exit transition, when the floating element is unmounted.
   */
  close(event?: Event): Promise<void>;

  /**
   * Opens when closed, closes when open.
   */
  toggle(event?: Event): void;

  /**
   * Whether the floating element is mounted.
   */
  isActive: Ref<boolean>;

  /**
   * Whether the panel is shown; trails `isActive` by the transitions.
   */
  isVisible: Ref<boolean>;
}

const ALLOWED_PLACEMENTS: Placement[] = ['bottom-start', 'bottom-end', 'top-start', 'top-end'];

css`
  .ohne-floater {
    display: flex;
    width: 100%;
    height: calc(2em + 0.25rem);
    font-size: calc(1rem + var(--ohne-size) * 0.125rem);
  }

  .ohne-floater-has-errors {
    --ohne-ring: var(--ohne-destructive);
    border-color: hsl(var(--ohne-destructive));
  }

  .ohne-floater-handle {
    --ohne-background: var(--ohne-card);
    position: relative;
    display: flex;
    align-items: center;
    gap: 0.5em;
    width: 100%;
    height: 100%;
    padding: 0 0.5em;
    background-color: hsl(var(--ohne-card));
    border: 1px solid hsl(var(--ohne-input));
    border-radius: calc(var(--ohne-radius) - 0.125rem);
    outline: none;
    cursor: pointer;
    color: hsl(var(--ohne-card-foreground));
    transition: var(--ohne-transition);
    transition-property: border-color, box-shadow;
  }

  .ohne-floater-has-errors .ohne-floater-handle {
    --ohne-ring: var(--ohne-destructive);
    border-color: hsl(var(--ohne-destructive));
  }

  .ohne-floater-handle:focus-visible {
    border-color: transparent;
    box-shadow: 0 0 0 0.125rem hsl(var(--ohne-ring));
    outline: none;
  }

  .ohne-floater-disabled .ohne-floater-handle {
    --ohne-foreground: var(--ohne-muted-foreground);
    background-color: hsl(var(--ohne-muted));
    cursor: default;
    color: hsl(var(--ohne-muted-foreground));
  }

  .ohne-floater-floating {
    z-index: 99997;
    max-width: 100%;
    outline: none;
  }

  .ohne-floater-container {
    --ohne-background: var(--ohne-card);
    height: 100%;
    overflow-y: auto;
    scrollbar-width: thin;
    scrollbar-color: hsl(var(--ohne-foreground) / 0.25) transparent;
    background-color: hsl(var(--ohne-card));
    box-shadow: 0 0 0 0.125rem hsl(var(--ohne-ring));
    border-radius: calc(var(--ohne-radius) - 0.125rem);
    outline: none;
    transition: var(--ohne-transition);
    transition-property: opacity, visibility, transform;
  }

  .ohne-floater:not(.ohne-floater-visible) .ohne-floater-container {
    opacity: 0;
    visibility: hidden;
    transform: translate3d(0, -0.5rem, 0) scale(0.95);
  }

  .ohne-floater:not(.ohne-floater-visible) .ohne-floater-floating-top-start .ohne-floater-container,
  .ohne-floater:not(.ohne-floater-visible) .ohne-floater-floating-top-end .ohne-floater-container {
    transform: translate3d(0, 0.5rem, 0) scale(0.95);
  }
`;

/**
 * The picker overlay engine, ported 1-to-1 from Pruvious v4's `PUIFloater`.
 *
 * A full-width handle button toggles a panel positioned by `placeFloating`.
 * Bottom-start is preferred, the roomiest corner wins, 7px gap, 8px viewport padding, clamped to fit.
 * While open, the window and an optional container are scroll-locked.
 * Escape closes in the capture phase ahead of everything else; clicks outside and resizes close too.
 * After the overlay transition a focus trap cycles Tab inside the panel.
 * Keyboard closes refocus the handle; mouse closes leave focus where the click put it.
 * The panel content mounts fresh per open and repositions on scroll and element resize.
 *
 * @example
 * ```ts
 * const picker = floater(list, { handle: () => label.value })
 * parent.append(picker.root)
 * ```
 */
export function floater(content: Child | (() => Child), options: FloaterOptions = {}): Floater {
  const error = options.error ?? ((): boolean => false);
  const disabled = options.disabled ?? ((): boolean => false);
  const strategy = options.strategy ?? 'fixed';
  const isActive = ref(false);
  const isVisible = ref(false);
  const placement = ref<Placement>('bottom-start');

  let floatingEl: HTMLElement | null = null;
  let containerEl: HTMLElement | null = null;
  let transitionDuration = 300;
  let stopKeydown: (() => void) | undefined;
  let stopOutsideClick: (() => void) | undefined;
  let stopResize: (() => void) | undefined;
  let unlockWindow: (() => void) | undefined;
  let unlockContainer: (() => void) | undefined;
  let releaseTrap: (() => void) | undefined;

  const handle = h(
    'button',
    {
      class: 'ohne-floater-handle ohne-raw',
      type: 'button',
      'aria-expanded': () => (isVisible.value ? 'true' : 'false'),
      tabindex: () => (disabled() ? -1 : 0),
      title: options.handleTitle,
      onBlur: () => options.onBlurHandle?.(),
      onClick: () => {
        if (!disabled()) toggle();
      },
    },
    options.handle,
  ) as HTMLButtonElement;

  const update = (): void => {
    const floating = floatingEl;
    const container = containerEl;
    if (!floating || !container) return;
    const rect = handle.getBoundingClientRect();
    const input = {
      reference: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      viewport: {
        width: document.documentElement.clientWidth,
        height: document.documentElement.clientHeight,
      },
      allowedPlacements: ALLOWED_PLACEMENTS,
      offset: 7,
      shiftPadding: 8,
      sizePadding: 8,
    };
    let placed = placeFloating({
      ...input,
      floating: { width: floating.offsetWidth, height: floating.offsetHeight },
    });
    // The clamps mirror the source's size middleware: set when starved for space, never removed.
    let clamped = false;
    if (placed.availableWidth < container.offsetWidth) {
      floating.style.width = `${Math.max(0, placed.availableWidth)}px`;
      clamped = true;
    }
    if (placed.availableHeight - 8 < container.scrollHeight) {
      floating.style.height = `${Math.max(0, placed.availableHeight - 8)}px`;
      clamped = true;
    }
    if (clamped) {
      placed = placeFloating({
        ...input,
        floating: { width: floating.offsetWidth, height: floating.offsetHeight },
      });
    }
    if (strategy === 'fixed') {
      floating.style.left = `${placed.x}px`;
      floating.style.top = `${placed.y}px`;
    } else {
      const parent = floating.offsetParent;
      if (parent instanceof HTMLElement) {
        const parentRect = parent.getBoundingClientRect();
        floating.style.left = `${placed.x - parentRect.x - parent.clientLeft + parent.scrollLeft}px`;
        floating.style.top = `${placed.y - parentRect.y - parent.clientTop + parent.scrollTop}px`;
      } else {
        floating.style.left = `${placed.x + window.scrollX}px`;
        floating.style.top = `${placed.y + window.scrollY}px`;
      }
    }
    placement.value = placed.placement;
  };

  const buildFloating = (): Child => {
    const container = h('div', { class: 'ohne-floater-container' }, content);
    const floating = h(
      'div',
      {
        tabindex: '-1',
        class: () => `ohne-floater-floating ohne-floater-floating-${placement.value}`,
        style: `position: ${strategy}; left: 0; top: 0;${
          isUndefined(options.size) ? '' : ` --ohne-size: ${options.size};`
        }`,
      },
      container,
    );
    floatingEl = floating;
    containerEl = container;
    const observer = new ResizeObserver(update);
    observer.observe(handle);
    observer.observe(floating);
    window.addEventListener('scroll', update, { capture: true, passive: true });
    window.addEventListener('resize', update);
    onCleanup(() => {
      observer.disconnect();
      window.removeEventListener('scroll', update, { capture: true });
      window.removeEventListener('resize', update);
      floatingEl = null;
      containerEl = null;
    });
    return floating;
  };

  const activateTrap = (): void => {
    const onTab = (event: KeyboardEvent): void => {
      if (event.key !== 'Tab') return;
      const floating = floatingEl;
      if (!floating) return;
      const order = [...floating.querySelectorAll<HTMLElement>(FOCUSABLE)];
      const first = order[0];
      const final = last(order);
      if (isUndefined(first) || isUndefined(final)) {
        event.preventDefault();
        return;
      }
      const active = document.activeElement;
      if (!active || !floating.contains(active)) {
        event.preventDefault();
        (event.shiftKey ? final : first).focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        final.focus();
      } else if (!event.shiftKey && active === final) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onTab, { capture: true });
    releaseTrap = () => document.removeEventListener('keydown', onTab, { capture: true });
  };

  const open = async (event?: Event): Promise<void> => {
    if (untracked(() => isActive.value)) return;
    event?.preventDefault();
    options.onOpen?.();
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    const onKeydown = (keyboard: KeyboardEvent): void => {
      if (keyboard.key === 'Escape') {
        if (options.onEscapeKey) {
          options.onEscapeKey(keyboard);
        } else {
          keyboard.preventDefault();
          keyboard.stopImmediatePropagation();
          void close(keyboard);
          handle.focus();
        }
      } else {
        options.onKeydown?.(keyboard);
      }
    };
    window.addEventListener('keydown', onKeydown, { capture: true });
    stopKeydown = () => window.removeEventListener('keydown', onKeydown, { capture: true });
    isActive.value = true;
    await nextTick();
    update();
    isVisible.value = true;
    await nextTick();
    stopOutsideClick = listenClickOutside(root, () => void close());
    const onResize = (): void => void close();
    window.addEventListener('resize', onResize);
    stopResize = () => window.removeEventListener('resize', onResize);
    unlockWindow = lockScroll(document.documentElement);
    unlockContainer = options.scrollContainer ? lockScroll(options.scrollContainer) : undefined;
    setTimeout(() => {
      if (untracked(() => isVisible.value)) activateTrap();
    }, transitionDuration);
  };

  const close = async (event?: Event): Promise<void> => {
    if (!untracked(() => isActive.value)) return;
    event?.preventDefault();
    options.onClose?.();
    releaseTrap?.();
    releaseTrap = undefined;
    stopKeydown?.();
    stopKeydown = undefined;
    if (event instanceof KeyboardEvent || (event instanceof PointerEvent && !event.pointerType)) {
      handle.focus();
    }
    isVisible.value = false;
    await sleep(transitionDuration);
    isActive.value = false;
    stopOutsideClick?.();
    stopOutsideClick = undefined;
    stopResize?.();
    stopResize = undefined;
    unlockWindow?.();
    unlockWindow = undefined;
    unlockContainer?.();
    unlockContainer = undefined;
  };

  const toggle = (event?: Event): void => {
    if (untracked(() => isActive.value)) void close(event);
    else void open(event);
  };

  const root = h(
    'div',
    {
      class: () => {
        let classes = 'ohne-floater';
        if (isVisible.value) classes += ' ohne-floater-visible';
        if (error()) classes += ' ohne-floater-has-errors';
        if (disabled()) classes += ' ohne-floater-disabled';
        return classes;
      },
      style: isUndefined(options.size) ? undefined : `--ohne-size: ${options.size};`,
    },
    handle,
    when(() => isActive.value, buildFloating),
    options.after,
  );

  setTimeout(() => {
    const duration = getComputedStyle(document.body).getPropertyValue(
      '--ohne-overlay-transition-duration',
    );
    transitionDuration = duration.endsWith('ms')
      ? Number.parseInt(duration, 10)
      : duration.endsWith('s')
        ? Number.parseFloat(duration) * 1000
        : 300;
  });
  onCleanup(() => void close());

  return {
    root,
    handle,
    container: () => containerEl,
    open,
    close,
    toggle,
    isActive,
    isVisible,
  };
}
