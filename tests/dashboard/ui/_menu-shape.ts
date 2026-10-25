import type { Text } from '../../../src/dashboard/runtime/text.ts';
import type { MenuAction, MenuGroup } from '../../../src/dashboard/ui/menu.ts';

import { isFunction } from '../../../src/utils/is/is-function.ts';
import { isString } from '../../../src/utils/is/is-string.ts';
import { ariaKeyShortcut } from '../../../src/utils/keys/aria-key-shortcut.ts';
import { FakeElement, type FakeNode, findElement } from '../_fake-dom.ts';

const { menuActions } = await import('../../../src/dashboard/ui/_menu-rows.ts');
const { hotkeySpecs } = await import('../../../src/dashboard/ui/hotkey-match.ts');
const { isMac } = await import('../../../src/dashboard/ui/hotkeys.ts');

/**
 * A row's label as written: the message key, or the plain string.
 */
const labelOf = (label: Text): string =>
  isFunction<() => string>(label) ? label() : isString(label) ? label : label.key;

const rowShape = (action: MenuAction): string =>
  `${labelOf(action.label)}${action.hotkey ? `[${action.hotkey}]` : ''}`;

/**
 * The shape of menu `groups` as one line: each row's label and `[hotkey]`, rows by `, `, groups by ` | `.
 */
export function shapeOf(groups: readonly MenuGroup[]): string {
  return menuActions(groups)
    .map((group) => group.map(rowShape).join(', '))
    .join(' | ');
}

/**
 * The shape of a mounted menu under `root`, in the same form as `shapeOf`.
 * The hotkey is read back from the row's `aria-keyshortcuts`.
 */
export function shapeOfDOM(root: FakeNode): string {
  const keys = new Map(
    Object.entries(hotkeySpecs(isMac())).map(([action, spec]) => [ariaKeyShortcut(spec), action]),
  );
  const parts: string[] = [];
  const walk = (node: FakeNode): void => {
    for (const child of node.childNodes) {
      if (!(child instanceof FakeElement)) continue;
      if (child.tagName === 'HR') parts.push(' | ');
      else if (child.getAttribute('role') === 'menuitem') {
        const kbd = findElement(child, (inner) => inner.tagName === 'KBD');
        const shortcut = child.getAttribute('aria-keyshortcuts');
        const text = child.textContent;
        const label = kbd ? text.slice(0, -kbd.textContent.length) : text;
        const hint = shortcut === null ? '' : `[${keys.get(shortcut)}]`;
        if (parts.length > 0 && parts.at(-1) !== ' | ') parts.push(', ');
        parts.push(`${label}${hint}`);
      } else walk(child);
    }
  };
  walk(root);
  return parts.join('');
}
