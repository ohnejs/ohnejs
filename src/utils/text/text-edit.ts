/**
 * One edit to a text: the range to replace, the text to put there, and the selection afterwards.
 * Offsets `from`, `to` index the text before the edit; `start`, `end` index the text after it.
 *
 * @example
 * ```ts
 * const edit: TextEdit = { from: 0, to: 0, insert: '  ', start: 2, end: 2 }
 * ```
 */
export interface TextEdit {
  /**
   * Where the replaced range starts.
   */
  from: number;

  /**
   * Where the replaced range ends, exclusive.
   */
  to: number;

  /**
   * The text that replaces `from..to`.
   */
  insert: string;

  /**
   * Where the selection starts after the edit.
   */
  start: number;

  /**
   * Where the selection ends after the edit.
   */
  end: number;
}
