import type { Child } from '../render/insert.ts';

import { last } from '../../utils/array/last.ts';
import { onCleanup } from '../../utils/reactive/effect-scope.ts';
import { css } from '../render/css.ts';
import { h } from '../render/h.ts';
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

const stack: symbol[] = [];

css`
  .ohne-drawer-catcher {
    position: fixed;
    inset: 0;
    z-index: 10;
  }

  .ohne-drawer {
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    z-index: 11;
    width: 380px;
    box-sizing: border-box;
    background: var(--paper);
    border-left: 1px solid var(--hairline);
    padding: 24px 28px;
    overflow-y: auto;
  }

  .ohne-drawer-title {
    margin: 0;
    font-size: 17px;
    font-weight: 700;
    letter-spacing: -0.01em;
  }

  .ohne-drawer-rule {
    border: none;
    border-top: 1px solid var(--hairline);
    margin: 12px 0 24px;
  }
`;

/**
 * A Ledger drawer: a paper panel over the right edge, split from the page by one hairline.
 * Escape and a click outside ask it to close; the owner decides by unmounting it.
 *
 * @example
 * ```ts
 * when(() => open.value, () =>
 *   drawer({ title: () => 'New record', onClose: () => (open.value = false) }, form()),
 * )
 * ```
 */
export function drawer(options: DrawerOptions, ...content: Child[]): Child {
  const token = Symbol('drawer');
  stack.push(token);
  const onEscape = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return;
    // Every open drawer listens on `document`, and `stopPropagation` does not silence a sibling
    // listener on the same node. Only the topmost may answer, or one Escape closes them all.
    if (last(stack) !== token) return;
    event.stopPropagation();
    options.onClose();
  };
  document.addEventListener('keydown', onEscape, { capture: true });
  onCleanup(() => {
    document.removeEventListener('keydown', onEscape, { capture: true });
    const at = stack.indexOf(token);
    if (at !== -1) stack.splice(at, 1);
  });
  return [
    h('div', { class: 'ohne-drawer-catcher', onClick: () => options.onClose() }),
    h(
      'div',
      { class: 'ohne-drawer' },
      h('h2', { class: 'ohne-drawer-title' }, options.title),
      h('hr', { class: 'ohne-drawer-rule' }),
      content,
    ),
  ];
}
