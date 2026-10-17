import type { TextEdit } from './text-edit.ts';

import { editLines } from './_lines.ts';

/**
 * Prepends `unit` to every line the selection `start..end` touches, skipping empty lines.
 * A selection that ends at a line start leaves that line alone.
 * A selection start at its line start stays there, so the selection widens over the new indent.
 *
 * @example
 * ```ts
 * indentLines('a\nb', 0, 3, '  ')
 * // -> { from: 0, to: 3, insert: '  a\n  b', start: 0, end: 7 }
 *
 * indentLines('a\n\nb', 1, 1, '\t')
 * // -> { from: 0, to: 1, insert: '\ta', start: 2, end: 2 }
 * ```
 */
export function indentLines(text: string, start: number, end: number, unit: string): TextEdit {
  return editLines(text, start, end, (line) => ({ cut: 0, put: line === '' ? '' : unit }));
}
