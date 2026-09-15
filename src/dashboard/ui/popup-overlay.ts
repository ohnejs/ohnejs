import type { Child } from '../render/insert.ts';

import { last } from '../../utils/array/last.ts';
import { isFunction } from '../../utils/is/is-function.ts';
import { isUndefined } from '../../utils/is/is-undefined.ts';
import { onCleanup } from '../../utils/reactive/effect-scope.ts';
import { effect } from '../../utils/reactive/effect.ts';
import { nextTick } from '../../utils/reactive/next-tick.ts';
import { ref } from '../../utils/reactive/ref.ts';
import { sleep } from '../../utils/sleep/sleep.ts';
import { css } from '../render/css.ts';
import { h } from '../render/h.ts';
import { container } from './container.ts';
import { isEditingText } from './hotkeys.ts';
import { acquireOverlay, FOCUSABLE, type OverlayHandle } from './overlay.ts';
import './tokens.ts';

/**
 * The close function a popup hands to its slots and `onClose`.
 * It animates the popup out and resolves after the overlay transition; the caller then unmounts.
 */
export type PopupClose = () => Promise<void>;

/**
 * Options for `popup`.
 */
export interface PopupOptions {
  /**
   * The CSS width of the popup.
   *
   * @default
   * '50rem'
   */
  width?: string;

  /**
   * Whether the popup expands to full height with a sticky header and footer.
   * `'auto'` keeps the sticky chrome while the popup stays content-sized up to the full height.
   *
   * @default
   * false
   */
  fullHeight?: boolean | 'auto';

  /**
   * Additional classes applied to the popup root.
   * `'ohne-popup-no-padding'` strips the inner content padding in full-height mode.
   */
  additionalClasses?: string[];

  /**
   * Size step of the component: -2 very small, -1 small, 0 default, 1 large, 2 very large.
   * Omitted inherits `--ohne-size` from the nearest ancestor.
   */
  size?: number;

  /**
   * The duration of the popup's open and close transition in milliseconds.
   * Also written inline as `--ohne-overlay-transition-duration`.
   *
   * @default
   * 300
   */
  overlayTransitionDuration?: number;

  /**
   * The header slot, rendered above the content with a bottom border.
   * A function form receives the close function.
   */
  header?: Child | ((close: PopupClose) => Child);

  /**
   * The footer slot, rendered below the content with a top border.
   * A function form receives the close function.
   */
  footer?: Child | ((close: PopupClose) => Child);

  /**
   * Called on overlay click and on Escape with the close function.
   * The popup never unmounts itself: call `close()`, then dispose the region that created it.
   */
  onClose?: (close: PopupClose) => void;

  /**
   * Called for every keydown inside the popup and for every window-level keydown outside it.
   * Inside keydowns stop propagating at the popup root, so each event arrives exactly once.
   */
  onKeydown?: (event: KeyboardEvent) => void;

  /**
   * Called once, roughly the overlay transition after mount.
   * A window `CustomEvent` named `ohne-overlay-animated` dispatches at the same moment.
   */
  onOverlayAnimated?: () => void;
}

/**
 * A mounted popup: the elements plus the close surface.
 */
export interface Popup {
  /**
   * The popup root, appended to `document.body`.
   */
  root: HTMLElement;

  /**
   * The content element.
   * The whole-viewport root scrolls a default popup; in full-height mode this element scrolls.
   */
  content: HTMLElement;

  /**
   * Closes the popup with a transition; resolves when the transition is complete.
   * The caller unmounts afterwards.
   */
  close: PopupClose;

  /**
   * Focuses the popup root, now and again after the overlay transition.
   */
  focus(): void;
}

const trapStack: HTMLElement[] = [];

css`
  .ohne-popup {
    position: fixed;
    z-index: 100;
    top: 0;
    right: 0;
    bottom: 0;
    left: 0;
    display: flex;
    padding: 1rem;
    outline: none;
  }

  .ohne-popup:not(.ohne-popup-full-height) .ohne-container-content {
    display: flex;
  }

  .ohne-popup-overlay {
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    left: 0;
    background-color: rgba(0, 0, 0, 0.64);
    transition: var(--ohne-transition);
    transition-duration: var(--ohne-overlay-transition-duration);
    transition-property: opacity;
  }

  .ohne-popup:not(.ohne-popup-visible) .ohne-popup-overlay {
    opacity: 0;
  }

  .ohne-popup-container {
    --ohne-background: var(--ohne-card);
    --ohne-foreground: var(--ohne-card-foreground);
    position: relative;
    display: block;
    max-width: 100%;
    margin: auto;
    background-color: hsl(var(--ohne-card));
    border-radius: var(--ohne-radius);
    box-shadow: var(--ohne-shadow);
    font-size: calc(1rem + var(--ohne-size) * 0.125rem);
    transition: var(--ohne-transition);
    transition-duration: var(--ohne-overlay-transition-duration);
    transition-property: opacity, transform;
  }

  .ohne-popup:not(.ohne-popup-visible) .ohne-popup-container {
    opacity: 0;
    transform: translate3d(0, 1.5rem, 0) scale(0.97);
  }

  .ohne-popup-full-height .ohne-popup-container {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .ohne-popup-auto-height .ohne-popup-container {
    display: flex;
    flex-direction: column;
    height: auto;
    max-height: 100%;
  }

  .ohne-popup-header {
    padding: 0.75rem;
    border-bottom-width: 1px;
  }

  .ohne-popup-full-height .ohne-popup-header {
    position: sticky;
    top: 0;
  }

  .ohne-popup:not(.ohne-popup-full-height) .ohne-popup-content,
  .ohne-popup:not(.ohne-popup-no-padding) .ohne-popup-content .ohne-container-content {
    padding: 0.75rem;
  }

  .ohne-popup-content {
    container-type: inline-size;
  }

  .ohne-popup-full-height .ohne-popup-content {
    position: relative;
    z-index: 1;
    flex: 1;
    outline: none;
  }

  .ohne-popup-footer {
    padding: 0.75rem;
    border-top-width: 1px;
  }

  .ohne-popup-full-height .ohne-popup-footer {
    position: sticky;
    bottom: 0;
  }

  @media (max-width: 767px) {
    .ohne-popup {
      padding: 0.5rem;
    }
  }
`;

/**
 * The modal layer.
 * A dimmed backdrop and a centered card appended to `document.body`, the base of every popup.
 *
 * Mounting claims an overlay depth a timeout later, so same-cycle hotkey instances pin to that depth.
 * It then autofocuses the first `[autofocus]`/`[data-autofocus]` descendant, falling back to the root.
 * Tab is trapped inside.
 * Escape defers a timeout so inner widgets can `preventDefault` first, and never closes while typing.
 * Like the overlay click, it only ever CALLS `onClose` - the popup unmounts nothing itself.
 * Once `close()` has run, neither trigger calls `onClose` again while the popup animates out.
 * Focus re-anchors to the root whenever it falls to `body` while the popup is topmost.
 * Create it inside a reactive region and dispose that region after `close()` resolves.
 * The cleanup removes the root and releases the overlay depth.
 *
 * @example
 * ```ts
 * when(() => open.value, () => {
 *   popup(form, { onClose: (close) => void close().then(() => (open.value = false)) })
 *   return null
 * })
 * ```
 */
export function popup(
  content: Child | ((close: PopupClose) => Child),
  options: PopupOptions = {},
): Popup {
  const width = options.width ?? '50rem';
  const fullHeight = options.fullHeight ?? false;
  const duration = options.overlayTransitionDuration ?? 300;
  const header = options.header;
  const footer = options.footer;
  const visible = ref(false);

  let overlay: OverlayHandle | undefined;
  let releaseTrap: (() => void) | undefined;
  let disposed = false;
  let closing = false;

  const close: PopupClose = async () => {
    closing = true;
    overlay?.undim();
    visible.value = false;
    await sleep(duration);
  };

  const slot = (value: Child | ((slotClose: PopupClose) => Child)): Child =>
    isFunction<(slotClose: PopupClose) => Child>(value) ? value(close) : value;

  // The live `container` scroll pane, so drag edge-scroll and pane locks work inside popups.
  const scrollPane = (classNames: string, children: Child | (() => Child)): HTMLElement => {
    const pane = container(children);
    for (const name of classNames.split(' ')) pane.classList.add(name);
    return pane;
  };

  const contentRoot = fullHeight
    ? scrollPane('ohne-popup-content', () => slot(content))
    : h('div', { class: 'ohne-popup-content' }, () => slot(content));

  const panel = h(
    'div',
    { class: 'ohne-popup-container', style: `width: ${width}` },
    isUndefined(header) ? null : h('div', { class: 'ohne-popup-header' }, () => slot(header)),
    contentRoot,
    isUndefined(footer) ? null : h('div', { class: 'ohne-popup-footer' }, () => slot(footer)),
  );

  const overlayEl = h('div', {
    class: 'ohne-popup-overlay',
    onClick: () => {
      if (!closing) options.onClose?.(close);
    },
  });

  const classes =
    'ohne-popup' +
    (fullHeight ? ' ohne-popup-full-height' : '') +
    (fullHeight === 'auto' ? ' ohne-popup-auto-height' : '') +
    (options.additionalClasses?.length ? ` ${options.additionalClasses.join(' ')}` : '');

  const root = fullHeight
    ? h('div', { tabindex: '-1', class: classes }, overlayEl, panel)
    : scrollPane(classes, [overlayEl, panel]);

  root.style.setProperty('--ohne-overlay-transition-duration', `${duration}ms`);
  if (!isUndefined(options.size)) root.style.setProperty('--ohne-size', String(options.size));

  effect(() => root.classList.toggle('ohne-popup-visible', visible.value));

  const focusRoot = (): void => {
    root.focus();
    setTimeout(() => root.focus(), duration);
  };

  const autofocus = (): void => {
    const el = root.querySelector('[autofocus], [data-autofocus]');
    if (el instanceof HTMLElement) {
      el.focus();
      setTimeout(() => el.focus(), duration);
    } else {
      focusRoot();
    }
  };

  const onEscapeKey = (event: KeyboardEvent): void => {
    setTimeout(() => {
      if (!closing && !event.defaultPrevented && !isEditingText()) options.onClose?.(close);
    });
  };

  root.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') onEscapeKey(event);
    event.stopPropagation();
    options.onKeydown?.(event);
  });

  const onWindowKeydown = (event: KeyboardEvent): void => options.onKeydown?.(event);
  window.addEventListener('keydown', onWindowKeydown);

  // Focus passes through a transient `body` between targets, so the re-anchor waits a macrotask.
  // It focuses the root once: the entrance transition's delayed second focus would steal the click.
  const onFocusChange = (): void => {
    setTimeout(() => {
      if (document.activeElement?.nodeName === 'BODY' && overlay?.isTopmost()) root.focus();
    });
  };
  window.addEventListener('focusin', onFocusChange);
  window.addEventListener('focusout', onFocusChange);

  const activateTrap = (): void => {
    trapStack.push(root);
    const onTab = (event: KeyboardEvent): void => {
      if (event.key !== 'Tab' || last(trapStack) !== root) return;
      const order = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)];
      const first = order[0];
      const final = last(order);
      if (isUndefined(first) || isUndefined(final)) {
        event.preventDefault();
        return;
      }
      const active = document.activeElement;
      if (!active || !root.contains(active)) {
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
    releaseTrap = () => {
      const at = trapStack.indexOf(root);
      if (at !== -1) trapStack.splice(at, 1);
      document.removeEventListener('keydown', onTab, { capture: true });
    };
  };

  document.body.appendChild(root);
  const mountTimer = setTimeout(() => {
    if (disposed) return;
    overlay = acquireOverlay();
    // Forcing a reflow paints the hidden state first, so the entrance transition is not skipped.
    void root.offsetWidth;
    visible.value = true;
    autofocus();
    void nextTick().then(() => {
      if (!disposed) activateTrap();
    });
    setTimeout(autofocus);
    setTimeout(() => {
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('ohne-overlay-animated'));
        options.onOverlayAnimated?.();
      }, duration);
    });
  });

  onCleanup(() => {
    disposed = true;
    clearTimeout(mountTimer);
    overlay?.release();
    releaseTrap?.();
    window.removeEventListener('keydown', onWindowKeydown);
    window.removeEventListener('focusin', onFocusChange);
    window.removeEventListener('focusout', onFocusChange);
    root.remove();
  });

  return { root, content: contentRoot, close, focus: focusRoot };
}
