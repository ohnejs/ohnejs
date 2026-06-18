import type { KeyStroke } from './key-stroke.ts';

/**
 * The subset of a browser `KeyboardEvent` a `KeyStroke` is built from.
 */
export interface KeyboardEventLike {
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

/**
 * Normalizes a browser `KeyboardEvent` into a `KeyStroke`.
 * The browser already speaks `KeyboardEvent.key`, so this is a straight field rename.
 *
 * @example
 * ```ts
 * window.addEventListener('keydown', (e) => match(strokeFromKeyboardEvent(e)))
 * ```
 */
export function strokeFromKeyboardEvent(event: KeyboardEventLike): KeyStroke {
  return {
    key: event.key,
    ctrl: event.ctrlKey,
    alt: event.altKey,
    shift: event.shiftKey,
    meta: event.metaKey,
  };
}
