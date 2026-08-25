import type { KeyStroke } from '../../utils/keys/key-stroke.ts';

/**
 * A named keyboard shortcut the dashboard understands.
 * The bindings are fixed, ported 1-to-1 from Pruvious v4: `delete` is Delete or Backspace
 * (plus Ctrl+D on mac), `close` is Escape, and the rest ride the platform modifier -
 * Command on mac, Control elsewhere.
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
   * Everything except `save` stands down while the user types.
   */
  editing: boolean;

  /**
   * Whether the instance is muted by an open overlay or the `ohne-no-interaction` body class.
   * Only `save` fires regardless, so Cmd/Ctrl+S always reaches its handler.
   */
  disabled: boolean;
}

/**
 * Resolves a keystroke to a hotkey action, or `null` when nothing matches.
 * The decision tree is the exact Pruvious v4 order: `delete` and `close` first, then the platform
 * gate (Command on mac, Control elsewhere, never with Alt or the other modifier), then the letter.
 * `save` alone ignores `editing` and `disabled`; on non-mac `Ctrl+Shift+Z` is deliberately nothing.
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
  const letter = stroke.key.toLowerCase();
  const idle = !context.editing && !context.disabled;
  const bare = !stroke.meta && !stroke.alt && !stroke.ctrl && !stroke.shift;

  if (
    idle &&
    (((stroke.key === 'Delete' || stroke.key === 'Backspace') && bare) ||
      (context.mac &&
        letter === 'd' &&
        stroke.ctrl &&
        !stroke.meta &&
        !stroke.alt &&
        !stroke.shift))
  ) {
    return 'delete';
  }
  if (idle && stroke.key === 'Escape' && bare) return 'close';
  if (context.mac && (!stroke.meta || stroke.alt || stroke.ctrl)) return null;
  if (!context.mac && (!stroke.ctrl || stroke.alt || stroke.meta)) return null;

  if (letter === 'y') return stroke.shift || !idle ? null : 'redo';
  if (letter === 'z') {
    if (!idle) return null;
    return context.mac && stroke.shift ? 'redo' : stroke.shift ? null : 'undo';
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
 * `insertAfter` and `insertBefore` carry no label, exactly as in Pruvious v4.
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
