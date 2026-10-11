import type { Child } from '../render/insert.ts';
import type { IconName } from './icon.ts';

import { isUndefined } from '../../utils/is/is-undefined.ts';
import { batchedEffect } from '../../utils/reactive/batched-effect.ts';
import { type EffectScope, effectScope, onCleanup } from '../../utils/reactive/effect-scope.ts';
import { ref } from '../../utils/reactive/ref.ts';
import { type MaybeGetter, toValue } from '../../utils/reactive/to-value.ts';
import { css } from '../render/css.ts';
import { h } from '../render/h.ts';
import { resolveText, type Text } from '../runtime/text.ts';
import { dropdownItem } from './dropdown-item.ts';
import { dropdown } from './dropdown.ts';
import { icon } from './icon.ts';
import './tokens.ts';

/**
 * One action row of a `menu`.
 */
export interface MenuAction {
  /**
   * The row label.
   */
  label: Text;

  /**
   * An icon before the label.
   */
  icon?: IconName;

  /**
   * Turns the row into a link; the router intercepts same-origin navigation.
   */
  href?: string;

  /**
   * The `target` attribute of the link.
   */
  target?: string;

  /**
   * Highlights the row in the destructive color on focus.
   *
   * @default
   * false
   */
  destructive?: boolean;

  /**
   * Dims the row and ignores its selection while it returns `true`.
   * The row stays focusable, so arrow keys still pass over it.
   */
  disabled?: () => boolean;

  /**
   * Called when the row is picked, right after the menu closes.
   */
  onSelect?: () => void;
}

/**
 * One row of a `menu`: an action, or `'---'` for a divider.
 */
export type MenuItem = MenuAction | '---';

css`
  .ohne-menu-item-disabled {
    cursor: default;
    opacity: 0.5;
  }
`;

/**
 * Wires `trigger` to open a dropdown menu of `items` on click, and returns it.
 * Rows without an icon indent to line up with rows that have one.
 * Dividers collapse at the edges and when doubled, so a filtered list never shows a stray rule.
 * The menu closes on a pick, Escape, or an outside click, and focus returns to the trigger.
 *
 * @example
 * ```ts
 * menu(button('Actions', { icon: 'dots', iconOnly: true, variant: 'ghost' }), [
 *   { label: 'Promote to officer', icon: 'shield', onSelect: promote },
 *   { label: 'Open profile', icon: 'user', href: '/members/thrall' },
 *   '---',
 *   { label: 'Remove from guild', icon: 'trash', destructive: true, onSelect: remove },
 * ])
 * ```
 */
export function menu(trigger: HTMLElement, items: MaybeGetter<readonly MenuItem[]>): HTMLElement {
  const expanded = ref(false);
  let scope: EffectScope | undefined;

  const close = (): void => {
    scope?.dispose();
    scope = undefined;
    expanded.value = false;
  };

  const open = (): void => {
    scope = effectScope(true);
    scope.run(() => {
      const handle = dropdown(() => rows(toValue(items), close), {
        reference: trigger,
        onClose: close,
      });
      handle.root.setAttribute('role', 'menu');
      (trigger.closest('.ohne-popup') ?? document.body).append(handle.root);
      onCleanup(() => handle.root.remove());
    });
    expanded.value = true;
  };

  trigger.setAttribute('aria-haspopup', 'menu');
  batchedEffect(() => trigger.setAttribute('aria-expanded', String(expanded.value)));
  trigger.addEventListener('click', () => (isUndefined(scope) ? open() : close()));
  onCleanup(close);
  return trigger;
}

/**
 * The dropdown rows for `items`, indenting icon-less rows when any row has an icon.
 */
function rows(items: readonly MenuItem[], close: () => void): Child[] {
  const indent = items.some((item) => item !== '---' && !isUndefined(item.icon));
  return items.map((item) => (item === '---' ? h('hr') : row(item, indent, close)));
}

/**
 * One action row, ignoring picks while disabled.
 */
function row(item: MenuAction, indent: boolean, close: () => void): HTMLElement {
  const { disabled, label } = item;
  const el = dropdownItem(
    [isUndefined(item.icon) ? null : icon(item.icon), h('span', null, () => resolveText(label))],
    {
      href: item.href,
      target: item.target,
      destructive: item.destructive,
      indent: indent && isUndefined(item.icon),
      onClick: (event: MouseEvent) => {
        if (disabled?.()) {
          event.preventDefault();
          return;
        }
        close();
        item.onSelect?.();
      },
    },
  );
  el.setAttribute('role', 'menuitem');
  if (!isUndefined(disabled)) {
    batchedEffect(() => {
      const off = disabled();
      el.classList.toggle('ohne-menu-item-disabled', off);
      if (off) el.setAttribute('aria-disabled', 'true');
      else el.removeAttribute('aria-disabled');
    });
  }
  return el;
}
