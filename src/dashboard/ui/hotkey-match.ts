import type { KeyStroke } from '../../utils/keys/key-stroke.ts';

import { isNull } from '../../utils/is/is-null.ts';

/**
 * A named keyboard shortcut the dashboard understands.
 * The bindings are fixed.
 * `delete` is Delete or Backspace (plus Ctrl+D on mac), and `close` is Escape.
 * The rest ride the platform modifier - Command on mac, Control elsewhere.
 */
export type HotkeyAction =
  | 'close'
  | 'copy'
  | 'cut'
  | 'delete'
  | 'duplicate'
  | 'insertAfter'
  | 'insertBefore'
  | 'moveDown'
  | 'moveUp'
  | 'paste'
  | 'redo'
  | 'save'
  | 'search'
  | 'selectAll'
  | 'undo';

/**
 * The state a hotkey decision depends on beyond the stroke itself.
 * The DOM-free shape keeps the matching model testable with plain objects.
 */
export interface HotkeyContext {
  /**
   * Whether the platform modifier is Command (`true`) or Control (`false`).
   */
  mac: boolean;

  /**
   * Whether focus sits in a text-editing element.
   * Everything except `save` and the `allowWhileTyping` actions stands down while the user types.
   */
  editing: boolean;

  /**
   * Whether the instance is muted by an open overlay or the `ohne-no-interaction` body class.
   * Only `save` fires regardless, so Cmd/Ctrl+S always reaches its handler.
   */
  disabled: boolean;

  /**
   * Actions that keep firing while `editing`, on top of `save`.
   * Listing `undo` and `redo` lets an app's own undo history win over the browser's text undo.
   *
   * @default
   * []
   */
  allowWhileTyping?: readonly HotkeyAction[];
}

/**
 * Resolves a keystroke to a hotkey action, or `null` when nothing matches.
 * `delete` and `close` come first, then the platform gate, then the letter.
 * The gate is Command on mac and Control elsewhere, never with Alt or the other modifier.
 * `save` alone ignores `editing` and `disabled`; on non-mac `Ctrl+Shift+Z` is deliberately nothing.
 * The `allowWhileTyping` actions ignore `editing` as well, but never `disabled`.
 *
 * @example
 * ```ts
 * const context = { mac: true, editing: false, disabled: false }
 *
 * matchHotkey({ key: 'z', ctrl: false, alt: false, shift: false, meta: true }, context) // -> 'undo'
 * matchHotkey({ key: 'z', ctrl: false, alt: false, shift: true, meta: true }, context)  // -> 'redo'
 * ```
 */
export function matchHotkey(stroke: KeyStroke, context: HotkeyContext): HotkeyAction | null {
  const action = resolveAction(stroke, context.mac, !context.disabled);
  if (isNull(action) || !context.editing || action === 'save') return action;
  return (context.allowWhileTyping ?? []).includes(action) ? action : null;
}

/**
 * Maps a stroke to its action without the `editing` gate; while not `idle`, only `save` resolves.
 */
function resolveAction(stroke: KeyStroke, mac: boolean, idle: boolean): HotkeyAction | null {
  const letter = stroke.key.toLowerCase();
  const bare = !stroke.meta && !stroke.alt && !stroke.ctrl && !stroke.shift;

  if (
    idle &&
    (((stroke.key === 'Delete' || stroke.key === 'Backspace') && bare) ||
      (mac && letter === 'd' && stroke.ctrl && !stroke.meta && !stroke.alt && !stroke.shift))
  ) {
    return 'delete';
  }
  if (idle && stroke.key === 'Escape' && bare) return 'close';
  if (mac && (!stroke.meta || stroke.alt || stroke.ctrl)) return null;
  if (!mac && (!stroke.ctrl || stroke.alt || stroke.meta)) return null;

  if (letter === 'y') return stroke.shift || !idle ? null : 'redo';
  if (letter === 'z') {
    if (!idle) return null;
    return mac && stroke.shift ? 'redo' : stroke.shift ? null : 'undo';
  }
  if (letter === 'k') return !stroke.shift && idle ? 'search' : null;
  if (letter === 'a') return !stroke.shift && idle ? 'selectAll' : null;
  if (letter === 'd') return !stroke.shift && idle ? 'duplicate' : null;
  if (letter === 'c') return !stroke.shift && idle ? 'copy' : null;
  if (letter === 'x') return !stroke.shift && idle ? 'cut' : null;
  if (letter === 'v') return !stroke.shift && idle ? 'paste' : null;
  if (letter === 's') return stroke.shift ? null : 'save';
  if (letter === 'arrowup' || letter === 'arrowdown') {
    if (!stroke.shift && idle) return letter === 'arrowup' ? 'moveUp' : 'moveDown';
    return null;
  }
  if (letter === 'enter') {
    if (!idle) return null;
    return stroke.shift ? 'insertBefore' : 'insertAfter';
  }
  return null;
}

/**
 * The display labels for the default hotkeys, e.g. `Cmd + S` for `save`.
 * `insertAfter` and `insertBefore` carry no label.
 *
 * @example
 * ```ts
 * hotkeyLabels(true).redo  // -> 'Cmd + Shift + Z'
 * hotkeyLabels(false).redo // -> 'Ctrl + Y'
 * ```
 */
export function hotkeyLabels(
  mac: boolean,
): Record<Exclude<HotkeyAction, 'insertAfter' | 'insertBefore'>, string> {
  const metaKey = mac ? 'Cmd' : 'Ctrl';

  return {
    close: 'Esc',
    copy: `${metaKey} + C`,
    cut: `${metaKey} + X`,
    delete: 'Del',
    duplicate: `${metaKey} + D`,
    moveDown: `${metaKey} + ↓`,
    moveUp: `${metaKey} + ↑`,
    paste: `${metaKey} + V`,
    redo: mac ? `${metaKey} + Shift + Z` : `${metaKey} + Y`,
    save: `${metaKey} + S`,
    search: `${metaKey} + K`,
    selectAll: `${metaKey} + A`,
    undo: `${metaKey} + Z`,
  };
}
