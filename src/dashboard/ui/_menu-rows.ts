import type { Child } from '../render/insert.ts';
import type { MenuAction, MenuGroup } from './menu.ts';

import { compact } from '../../utils/array/compact.ts';
import { intersperse } from '../../utils/array/intersperse.ts';
import { isNull } from '../../utils/is/is-null.ts';
import { isUndefined } from '../../utils/is/is-undefined.ts';
import { ariaKeyShortcut } from '../../utils/keys/aria-key-shortcut.ts';
import { strokeFromKeyboardEvent } from '../../utils/keys/stroke-from-keyboard-event.ts';
import { batchedEffect } from '../../utils/reactive/batched-effect.ts';
import { onCleanup } from '../../utils/reactive/effect-scope.ts';
import { css } from '../render/css.ts';
import { h } from '../render/h.ts';
import { resolveText } from '../runtime/text.ts';
import { dropdownItem } from './dropdown-item.ts';
import { hotkeyLabels, hotkeySpecs, matchHotkey } from './hotkey-match.ts';
import { isMac } from './hotkeys.ts';
import { icon } from './icon.ts';
import './tokens.ts';

css`
  .ohne-dropdown[role='menu'] {
    width: max-content;
    min-width: 15em;
    max-width: min(100%, 24em);
  }

  .ohne-dropdown[role='menu'] .ohne-dropdown-item-inner > kbd {
    padding-left: 1em;
  }

  .ohne-menu-item-disabled {
    cursor: default;
    opacity: 0.5;
  }
`;

/**
 * The action rows of `groups`, with skipped entries and empty groups dropped.
 *
 * @example
 * ```ts
 * menuActions([[edit, false], [], [undefined], [remove]]) // -> [[edit], [remove]]
 * ```
 */
export function menuActions(groups: readonly MenuGroup[]): MenuAction[][] {
  return groups.map((group) => compact(group)).filter((group) => group.length > 0);
}

/**
 * The dropdown rows for `groups`: a `menuitem` per action and an `hr` between groups that keep a row.
 * Icon-less rows indent when any row has an icon.
 * A pick on a disabled row is ignored; any other pick calls `close`, then the row's `onSelect`.
 * While the rows are shown, pressing a row's `hotkey` picks it.
 */
export function menuRows(groups: readonly MenuGroup[], close: () => void): Child[] {
  const actions = menuActions(groups);
  const indent = actions.some((group) => group.some((action) => !isUndefined(action.icon)));
  const keyed = new Map<string, HTMLElement>();
  const rows = intersperse(
    actions.map((group) =>
      group.map((action) => {
        const el = row(action, indent, close);
        if (!isUndefined(action.hotkey)) keyed.set(action.hotkey, el);
        return el;
      }),
    ),
    () => [h('hr')],
  ).flat();
  if (keyed.size > 0) {
    const onKeyDown = (event: KeyboardEvent): void => {
      const stroke = strokeFromKeyboardEvent(event);
      const action = matchHotkey(stroke, { mac: isMac(), editing: false, disabled: false });
      const el = isNull(action) ? undefined : keyed.get(action);
      if (isUndefined(el) || el.getAttribute('aria-disabled') === 'true') return;
      event.preventDefault();
      event.stopPropagation();
      el.click();
    };
    // Capture, so the key reaches the row before the open dropdown claims it.
    document.addEventListener('keydown', onKeyDown, { capture: true });
    onCleanup(() => document.removeEventListener('keydown', onKeyDown, { capture: true }));
  }
  return rows;
}

/**
 * One action row, ignoring picks while disabled.
 */
function row(item: MenuAction, indent: boolean, close: () => void): HTMLElement {
  const { disabled, hotkey, label } = item;
  const keys = isUndefined(hotkey) ? [] : hotkeyLabels(isMac())[hotkey].split(' + ');
  const el = dropdownItem(
    [
      isUndefined(item.icon) ? null : icon(item.icon),
      h('span', null, () => resolveText(label)),
      keys.length === 0
        ? null
        : h(
            'kbd',
            { 'aria-hidden': 'true' },
            keys.map((key) => h('span', null, key)),
          ),
    ],
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
  if (!isUndefined(hotkey)) {
    el.setAttribute('aria-keyshortcuts', ariaKeyShortcut(hotkeySpecs(isMac())[hotkey]));
  }
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
