import type { KeyStroke } from './key-stroke.ts';

import { isString } from '../is/is-string.ts';

/**
 * The subset of a browser `KeyboardEvent` a `KeyStroke` is built from.
 */
export interface KeyboardEventLike {
  /**
   * The key value in `KeyboardEvent.key` form: `'a'`, `'Enter'`, `'ArrowLeft'`, `' '`.
   */
  key: string;

  /**
   * Whether the Control key was held.
   */
  ctrlKey: boolean;

  /**
   * Whether the Alt (Option on macOS) key was held.
   */
  altKey: boolean;

  /**
   * Whether the Shift key was held.
   */
  shiftKey: boolean;

  /**
   * Whether the Meta (Command on macOS, the Windows key elsewhere) key was held.
   */
  metaKey: boolean;
}

/**
 * Normalizes a browser `KeyboardEvent` into a `KeyStroke`.
 * The browser already speaks `KeyboardEvent.key`, so this is a straight field rename.
 * Chrome's autofill fires keydowns whose `key` is `undefined` despite the type; those read as `''`.
 *
 * @example
 * ```ts
 * window.addEventListener('keydown', (e) => match(strokeFromKeyboardEvent(e)))
 * ```
 */
export function strokeFromKeyboardEvent(event: KeyboardEventLike): KeyStroke {
  return {
    key: isString(event.key) ? event.key : '',
    ctrl: event.ctrlKey,
    alt: event.altKey,
    shift: event.shiftKey,
    meta: event.metaKey,
  };
}
