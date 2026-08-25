import type { Child } from '../render/insert.ts';

import { last } from '../../utils/array/last.ts';
import { isUndefined } from '../../utils/is/is-undefined.ts';
import { onCleanup } from '../../utils/reactive/effect-scope.ts';
import { css } from '../render/css.ts';
import { h } from '../render/h.ts';
import { button } from './button.ts';
import { acquireEscapeLayer } from './layers.ts';
import './tokens.ts';

/**
 * Options for `drawer`.
 */
export interface DrawerOptions {
  /**
   * The drawer's heading.
   */
  title: () => Child;

  /**
   * Called when the drawer asks to close: Escape, or a click outside it.
   */
  onClose(): void;
}

const FOCUSABLE =
  'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

let titles = 0;

css`
  .ohne-drawer-catcher {
    position: fixed;
    inset: 0;
    z-index: 10;
    background: rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(1.5px);
    animation: ohne-drawer-fade var(--glide);
  }

  @media (prefers-color-scheme: light) {
    .ohne-drawer-catcher {
      background: rgba(11, 12, 15, 0.28);
    }
  }

  .ohne-drawer {
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    z-index: 11;
    width: 380px;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    background: var(--surface);
    border-left: 1px solid var(--line-strong);
    animation: ohne-drawer-in var(--glide);
  }

  .ohne-drawer-head {
    flex: none;
    display: flex;
    align-items: center;
    gap: var(--s2);
    height: var(--bar);
    padding: 0 var(--s4);
    border-bottom: 1px solid var(--line);
  }

  .ohne-drawer-title {
    margin: 0;
    font-size: var(--fs-lead);
    font-weight: 500;
  }

  .ohne-button.ohne-drawer-close {
    margin-left: auto;
  }

  .ohne-drawer-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: var(--s5) var(--s4);
  }

  @keyframes ohne-drawer-in {
    from {
      transform: translateX(100%);
    }
  }

  @keyframes ohne-drawer-fade {
    from {
      opacity: 0;
    }
  }
`;

/**
 * A Console drawer: a dialog panel that slides over the right edge behind a blurred scrim.
 * Escape and a click outside ask it to close; the owner decides by unmounting it.
 * Focus moves to the first focusable element in the body, falling back to the close button.
 * Tab cycles within the panel, and the previously focused element gets focus back on unmount.
 *
 * @example
 * ```ts
 * when(() => open.value, () =>
 *   drawer({ title: () => 'New record', onClose: () => (open.value = false) }, form()),
 * )
 * ```
 */
export function drawer(options: DrawerOptions, ...content: Child[]): Child {
  const previous = document.activeElement;
  const titleId = `ohne-drawer-title-${(titles += 1)}`;
  const close = button('✕', {
    variant: 'ghost',
    class: 'ohne-drawer-close',
    onClick: () => options.onClose(),
  });
  const body = h('div', { class: 'ohne-drawer-body' }, content);
  const panel = h(
    'div',
    { class: 'ohne-drawer', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
    h(
      'div',
      { class: 'ohne-drawer-head' },
      h('h2', { class: 'ohne-drawer-title', id: titleId }, options.title),
      close,
    ),
    body,
  );
  panel.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') return;
    const order = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)];
    const first = order[0];
    const final = last(order);
    if (isUndefined(first) || isUndefined(final)) {
      event.preventDefault();
    } else if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      final.focus();
    } else if (!event.shiftKey && document.activeElement === final) {
      event.preventDefault();
      first.focus();
    }
  });
  onCleanup(acquireEscapeLayer(() => options.onClose()));
  onCleanup(() => {
    if (previous instanceof HTMLElement) previous.focus();
  });
  // Content autofocus queues before this microtask; only an unclaimed focus moves to the body.
  queueMicrotask(() => {
    if (panel.contains(document.activeElement)) return;
    (body.querySelector<HTMLElement>(FOCUSABLE) ?? close).focus();
  });
  return [h('div', { class: 'ohne-drawer-catcher', onClick: () => options.onClose() }), panel];
}
