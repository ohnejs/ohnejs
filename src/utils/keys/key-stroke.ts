/**
 * A keypress normalized across runtimes and platforms.
 * A browser `KeyboardEvent` and a terminal keypress both collapse to this shape.
 * That lets one keymap drive either.
 */
export interface KeyStroke {
  /**
   * The key value in `KeyboardEvent.key` form: `'a'`, `'Enter'`, `'ArrowLeft'`, `' '`.
   */
  key: string;

  /**
   * Whether the Control key was held.
   */
  ctrl: boolean;

  /**
   * Whether the Alt (Option on macOS) key was held.
   */
  alt: boolean;

  /**
   * Whether the Shift key was held.
   */
  shift: boolean;

  /**
   * Whether the Meta (Command on macOS, the Windows key elsewhere) key was held.
   */
  meta: boolean;
}
