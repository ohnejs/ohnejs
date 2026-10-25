import type { Text } from '../runtime/text.ts';
import type { LabeledHotkeyAction } from './hotkey-match.ts';
import type { IconName } from './icon.ts';

import { isUndefined } from '../../utils/is/is-undefined.ts';
import { batchedEffect } from '../../utils/reactive/batched-effect.ts';
import { type EffectScope, effectScope, onCleanup } from '../../utils/reactive/effect-scope.ts';
import { ref } from '../../utils/reactive/ref.ts';
import { type MaybeGetter, toValue } from '../../utils/reactive/to-value.ts';
import { menuActions, menuRows } from './_menu-rows.ts';
import { dropdown } from './dropdown.ts';

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
   * The hotkey whose platform label shows right-aligned on the row, e.g. `Cmd + D` for `duplicate`.
   * Pressing it while the menu is open picks the row; once closed, the key does whatever `useHotkeys` binds.
   */
  hotkey?: LabeledHotkeyAction;

  /**
   * Called when the row is picked, right after the menu closes.
   */
  onSelect?: () => void;
}

/**
 * One group of menu rows.
 * A falsy entry is skipped, so a row can be written as `allowed && action`.
 */
export type MenuGroup = readonly (MenuAction | false | undefined)[];

/**
 * Wires `trigger` to open a dropdown menu of `groups` on click, and returns it.
 * A divider separates groups that keep a row, so a filtered menu never shows a stray rule.
 * Rows without an icon indent to line up with rows that have one.
 * A click opens nothing while every group is empty.
 * A keyboard open focuses the first enabled row; a pointer open focuses the panel.
 * The menu closes on a pick, Escape, or an outside click, and focus returns to the trigger.
 *
 * @example
 * ```ts
 * menu(button('More actions', { icon: 'dots', iconOnly: true, variant: 'ghost' }), [
 *   [
 *     { label: 'Open profile', icon: 'user', href: '/members/thrall' },
 *     officer && { label: 'Promote to officer', icon: 'shield', onSelect: promote },
 *   ],
 *   [{ label: 'Remove from guild', icon: 'trash-x', destructive: true, onSelect: remove }],
 * ])
 * ```
 */
export function menu(trigger: HTMLElement, groups: MaybeGetter<readonly MenuGroup[]>): HTMLElement {
  const expanded = ref(false);
  let scope: EffectScope | undefined;

  const close = (): void => {
    scope?.dispose();
    scope = undefined;
    expanded.value = false;
  };

  const open = (keyboard: boolean): void => {
    scope = effectScope(true);
    scope.run(() => {
      const handle = dropdown(() => menuRows(toValue(groups), close), {
        reference: trigger,
        focusFirstRow: keyboard,
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
  // A click the keyboard synthesizes on a button carries no click count.
  trigger.addEventListener('click', (event) => {
    if (!isUndefined(scope)) close();
    else if (menuActions(toValue(groups)).length > 0) open(event.detail === 0);
  });
  onCleanup(close);
  return trigger;
}
