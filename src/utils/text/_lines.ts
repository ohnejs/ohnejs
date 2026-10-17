import type { TextEdit } from './text-edit.ts';

/**
 * The offset where the line holding `at` starts.
 */
export function lineStart(text: string, at: number): number {
  return at === 0 ? 0 : text.lastIndexOf('\n', at - 1) + 1;
}

/**
 * Rewrites the start of every line the selection `start..end` touches, carrying the selection along.
 * `edit` names how many leading characters to cut from a line and what to put in their place.
 * A selection that ends at a line start leaves that line alone.
 * A selection start at its line start stays there, so the selection widens over a prefix.
 */
export function editLines(
  text: string,
  start: number,
  end: number,
  edit: (line: string) => { cut: number; put: string },
): TextEdit {
  const from = lineStart(text, start);
  const last = end > start && text[end - 1] === '\n' ? end - 1 : end;
  const close = text.indexOf('\n', last);
  const to = close === -1 ? text.length : close;
  const lines = text.slice(from, to).split('\n');
  let insert = '';
  let nextStart = start;
  let nextEnd = end;
  let at = from;
  for (const [index, line] of lines.entries()) {
    const { cut, put } = edit(line);
    const map = (offset: number, stick: boolean): number =>
      from +
      insert.length +
      (stick && offset === at ? 0 : put.length) +
      Math.max(0, offset - at - cut);
    if (start >= at && start <= at + line.length) nextStart = map(start, start < end);
    if (end >= at && end <= at + line.length) nextEnd = map(end, false);
    insert += put + line.slice(cut) + (index < lines.length - 1 ? '\n' : '');
    at += line.length + 1;
  }
  if (end > to) nextEnd = end + insert.length - (to - from);
  return { from, to, insert, start: nextStart, end: nextEnd };
}
