import type { TextEdit } from './text-edit.ts';

import { editLines } from './_lines.ts';

/**
 * Removes one indent from the start of every line the selection `start..end` touches.
 * One indent is `unit`, else one tab, else up to `unit.length` spaces.
 * A selection that ends at a line start leaves that line alone.
 *
 * @example
 * ```ts
 * outdentLines('  a\n\tb', 0, 6, '  ')
 * // -> { from: 0, to: 6, insert: 'a\nb', start: 0, end: 3 }
 *
 * outdentLines('    a', 5, 5, '  ')
 * // -> { from: 0, to: 5, insert: '  a', start: 3, end: 3 }
 *
 * outdentLines(' a', 2, 2, '  ')
 * // -> { from: 0, to: 2, insert: 'a', start: 1, end: 1 }
 * ```
 */
export function outdentLines(text: string, start: number, end: number, unit: string): TextEdit {
  return editLines(text, start, end, (line) => ({ cut: indentWidth(line, unit), put: '' }));
}

/**
 * How many leading characters of `line` make one indent.
 */
function indentWidth(line: string, unit: string): number {
  if (line.startsWith(unit)) return unit.length;
  if (line.startsWith('\t')) return 1;
  let spaces = 0;
  while (spaces < unit.length && line[spaces] === ' ') spaces += 1;
  return spaces;
}
