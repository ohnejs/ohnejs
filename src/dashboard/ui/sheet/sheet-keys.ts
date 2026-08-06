import {
  createKeymap,
  type KeymapOptions,
  type KeyMatcher,
} from '../../../utils/keys/create-keymap.ts';

/**
 * What the sheet's keyboard drives; the sheet component supplies the implementations.
 * The shape is DOM-free, so the bindings are testable with recorded calls.
 */
export interface SheetActions {
  /**
   * Moves the selection focus by a delta; `extend` stretches the rectangle instead.
   */
  move(dx: number, dy: number, extend: boolean): void;

  /**
   * Selects the whole grid.
   */
  selectAll(): void;

  /**
   * Deselects everything.
   */
  clear(): void;

  /**
   * Steps one page forward or back.
   */
  page(delta: 1 | -1): void;

  /**
   * Opens the focused cell for editing.
   */
  edit(): void;
}

/**
 * The sheet's key bindings, compiled to a matcher.
 * Arrows move, with Shift they stretch; Home and End jump the row; `mod+a` selects all.
 * PageUp and PageDown step pages, Enter edits, Escape deselects.
 *
 * @example
 * ```ts
 * const match = sheetKeymap(actions)
 * match(strokeFromKeyboardEvent(event)) // -> true when handled
 * ```
 */
export function sheetKeymap(actions: SheetActions, options: KeymapOptions = {}): KeyMatcher {
  return createKeymap(
    {
      arrowup: () => actions.move(0, -1, false),
      arrowdown: () => actions.move(0, 1, false),
      arrowleft: () => actions.move(-1, 0, false),
      arrowright: () => actions.move(1, 0, false),
      'shift+arrowup': () => actions.move(0, -1, true),
      'shift+arrowdown': () => actions.move(0, 1, true),
      'shift+arrowleft': () => actions.move(-1, 0, true),
      'shift+arrowright': () => actions.move(1, 0, true),
      home: () => actions.move(-Infinity, 0, false),
      end: () => actions.move(Infinity, 0, false),
      'mod+a': () => actions.selectAll(),
      pageup: () => actions.page(-1),
      pagedown: () => actions.page(1),
      enter: () => actions.edit(),
      escape: () => actions.clear(),
    },
    options,
  );
}
