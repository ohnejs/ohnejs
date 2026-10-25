import type { ScreenPoint } from './floater-place.ts';
import type { MenuGroup } from './menu.ts';

import { isNull } from '../../utils/is/is-null.ts';
import { isUndefined } from '../../utils/is/is-undefined.ts';
import { type EffectScope, effectScope, onCleanup } from '../../utils/reactive/effect-scope.ts';
import { type MaybeGetter, toValue } from '../../utils/reactive/to-value.ts';
import { longPress } from './_long-press.ts';
import { menuActions, menuRows } from './_menu-rows.ts';
import { dropdown, referenceSize } from './dropdown.ts';

/**
 * Options for `contextMenu`.
 */
export interface ContextMenuOptions {
  /**
   * Whether a still touch hold opens the menu.
   * Turn it off where a hold already starts a drag.
   *
   * @default
   * true
   */
  touch?: boolean;

  /**
   * The duration in milliseconds a touch must hold to open the menu.
   *
   * @default
   * 500
   */
  touchDuration?: number;

  /**
   * The CSS selector of elements strictly inside `target` that keep the browser's own menu.
   * A `target` that matches it itself still opens the menu.
   *
   * @default
   * 'a[href], button, input, textarea, select, label, [contenteditable]'
   */
  ignore?: string;

  /**
   * Size step of the menu, from -2 (very small) to 2 (very large).
   * Omitted, the menu takes the `--ohne-size` around `target`.
   */
  size?: number;
}

const IGNORE = 'a[href], button, input, textarea, select, label, [contenteditable]';

/**
 * Touch starts an inner target armed, so an outer target never arms a second menu.
 */
const claimedTouches = new WeakSet<Event>();

/**
 * Wires `target` to open a menu of `groups` on a right-click or a touch hold, and returns it.
 * The menu opens below and after the pointer, and flips only to a corner where it fits.
 * The context-menu key and Shift+F10 open it too, while focus is inside `target`.
 * Then the menu opens below `target`, focused on its first enabled row.
 * `groups` is read on each open, so a getter sees the current selection.
 * Shift, text selected in `target`, an `ignore` match, or no action row leaves the browser's own menu.
 * The innermost target wins, and groups, dividers and closing on a pick work as in `menu`.
 * While its menu is open, `target` carries the `data-ohne-context-menu-open` attribute.
 * Offer each action elsewhere too, since a context menu is hard to discover.
 *
 * @example
 * ```ts
 * contextMenu(h('li', { tabindex: 0 }, member.name), () => [
 *   [{ label: 'Promote to officer', icon: 'shield', onSelect: () => promote(member) }],
 *   [{ label: 'Remove from guild', icon: 'trash-x', destructive: true, onSelect: () => remove(member) }],
 * ])
 * ```
 */
export function contextMenu(
  target: HTMLElement,
  groups: MaybeGetter<readonly MenuGroup[]>,
  options: ContextMenuOptions = {},
): HTMLElement {
  const ignore = options.ignore ?? IGNORE;
  let scope: EffectScope | undefined;
  let keyed = false;

  const close = (): void => {
    scope?.dispose();
    scope = undefined;
    keyed = false;
  };

  const open = (reference: HTMLElement | ScreenPoint, keyboard: boolean): boolean => {
    close();
    const rows = toValue(groups);
    if (menuActions(rows).length === 0) return false;
    scope = effectScope(true);
    scope.run(() => {
      const handle = dropdown(menuRows(rows, close), {
        reference,
        offset: keyboard ? undefined : 0,
        firstFit: true,
        focusFirstRow: keyboard,
        size: options.size ?? referenceSize(target),
        onClose: close,
      });
      handle.root.setAttribute('role', 'menu');
      (target.closest('.ohne-popup') ?? document.body).append(handle.root);
      // An attribute, not a class: a reactive `class` binding rewrites the whole list and would drop it.
      target.setAttribute('data-ohne-context-menu-open', '');
      onCleanup(() => {
        handle.root.remove();
        target.removeAttribute('data-ohne-context-menu-open');
      });
    });
    return true;
  };

  const ignored = (hit: EventTarget | null): boolean => {
    const match = hit instanceof Element ? hit.closest(ignore) : null;
    return !isNull(match) && match !== target && target.contains(match);
  };

  const selecting = (): boolean => {
    const selection = window.getSelection();
    return selection?.isCollapsed === false && selection.containsNode(target, true);
  };

  let touching = false;
  let held = false;
  let origin: ScreenPoint = { clientX: 0, clientY: 0 };
  let untrack = (): void => {};
  const press = longPress(options.touchDuration ?? 500, () => {
    held = open(origin, false);
  });

  const endTouch = (): void => {
    press.end();
    untrack();
    untrack = () => {};
    touching = false;
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    const key = event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey);
    if (!key || selecting() || ignored(event.target) || !open(target, true)) return;
    keyed = true;
    event.preventDefault();
    event.stopPropagation();
  };

  const onContextMenu = (event: MouseEvent): void => {
    // A hold or a menu key that opened it may be followed by the browser's own `contextmenu`.
    if (held || keyed) {
      keyed = false;
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const { clientX, clientY } = event;
    const rect = target.getBoundingClientRect();
    const keyboard =
      (clientX === 0 && clientY === 0) ||
      !(
        clientX >= rect.left &&
        clientX < rect.right &&
        clientY >= rect.top &&
        clientY < rect.bottom
      );
    if ((event.shiftKey && !keyboard) || selecting() || ignored(event.target)) return;
    if (!open(keyboard ? target : { clientX, clientY }, keyboard)) return;
    if (touching) {
      press.end();
      held = true;
    }
    event.preventDefault();
    event.stopPropagation();
  };

  const onTouchStart = (event: TouchEvent): void => {
    endTouch();
    held = false;
    const start = event.touches[0];
    const hit = event.target;
    if (event.touches.length > 1 || isUndefined(start) || isNull(hit)) return;
    if (claimedTouches.has(event) || ignored(hit)) return;
    claimedTouches.add(event);
    const onMove = (move: Event): void => {
      const touch = (move as TouchEvent).touches[0];
      if (touch) press.move(touch);
    };
    const onCancel = (): void => {
      endTouch();
      held = false;
    };
    // Touch events keep targeting the touched node, even once it leaves the target.
    hit.addEventListener('touchmove', onMove, { passive: true });
    hit.addEventListener('touchcancel', onCancel);
    untrack = () => {
      hit.removeEventListener('touchmove', onMove);
      hit.removeEventListener('touchcancel', onCancel);
    };
    touching = true;
    origin = { clientX: start.clientX, clientY: start.clientY };
    press.start(start);
  };

  const onTouchEnd = (event: TouchEvent): void => {
    endTouch();
    if (!held) return;
    held = false;
    event.preventDefault();
    setTimeout(() => window.getSelection()?.removeAllRanges(), 50);
  };

  target.addEventListener('contextmenu', onContextMenu);
  target.addEventListener('keydown', onKeyDown);
  if (options.touch ?? true) {
    target.addEventListener('touchstart', onTouchStart, { passive: true });
    target.addEventListener('touchend', onTouchEnd);
  }
  onCleanup(() => {
    endTouch();
    close();
    target.removeEventListener('contextmenu', onContextMenu);
    target.removeEventListener('keydown', onKeyDown);
    target.removeEventListener('touchstart', onTouchStart);
    target.removeEventListener('touchend', onTouchEnd);
  });
  return target;
}
