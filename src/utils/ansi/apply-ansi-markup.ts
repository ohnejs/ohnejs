import type { ANSIColors } from './pick-ansi-colors.ts';

import { nextIndexes } from '../array/next-indexes.ts';
import { isUndefined } from '../is/is-undefined.ts';
import { codeSpanText } from './code-span-text.ts';
import { codeSpans } from './code-spans.ts';

/**
 * One open markup pair: its content range, the text rendered so far, and how to style it once it closes.
 */
interface Frame {
  start: number;
  end: number;
  cursor: number;
  out: string;
  style: (text: string) => string;
}

const SPACE = /\s/;

/**
 * Applies inline markup to text: `__x__` dims, `**x**` bolds, and a backtick span highlights.
 * A backtick span holds no other markup, and binds before it, so no `**` or `__` closes inside a span.
 * As in Markdown, a span closes only at a backtick run of its own length and drops one padding space per side.
 * A `__` or `**` pair opens at a word start and closes at a word end, both at whitespace or a line edge.
 * Highlight renders cyan, or bold when `emphasize` is set.
 * Set `emphasize` when the surrounding text is already tinted, so the highlight still stands out.
 *
 * @example
 * ```ts
 * const color = pickANSIColors(true)
 * applyANSIMarkup('open `x` end', false, color)     // -> 'open \x1b[96mx\x1b[39m end'
 * applyANSIMarkup('open `x` end', true, color)      // -> 'open \x1b[1mx\x1b[22m end'
 * applyANSIMarkup('open ``a`b`` end', false, color) // -> 'open \x1b[96ma`b\x1b[39m end'
 * ```
 */
export function applyANSIMarkup(text: string, emphasize: boolean, colors: ANSIColors): string {
  const highlight = emphasize ? colors.bold : colors.cyan;
  const { ends, masked } = codeSpans(text);
  const isSpace = (index: number) => SPACE.test(masked[index] ?? '');
  const closes = (mark: string, index: number) =>
    masked.startsWith(mark, index) && !isSpace(index - 1);
  const closersOf = (mark: string) =>
    nextIndexes(
      masked.length,
      (index) => closes(mark, index) && (index + 2 === masked.length || isSpace(index + 2)),
    );
  const closers: Record<string, (from: number) => number> = {
    '**': closersOf('**'),
    __: closersOf('__'),
  };
  const newlines = nextIndexes(masked.length, (index) => masked[index] === '\n');

  // Content is read as text of its own, so its end is a line edge and a mark just before it closes.
  const closer = (mark: string, from: number, end: number): number => {
    const next = closers[mark]!(from);
    if (next + 2 <= end) return next;
    return end - 2 >= from && closes(mark, end - 2) ? end - 2 : -1;
  };

  const markupEnd = (index: number, start: number, end: number): number | undefined => {
    const char = masked[index];
    if (char === '`') return ends.get(index);
    if ((char !== '*' && char !== '_') || masked[index + 1] !== char) return undefined;
    if ((index > start && !isSpace(index - 1)) || index + 2 >= end || isSpace(index + 2))
      return undefined;
    const close = closer(char + char, index + 3, end);
    return close === -1 || newlines(index + 2) < close ? undefined : close + 2;
  };

  // An explicit stack, not recursion, so no nesting depth overflows the call stack.
  const frames: Frame[] = [
    { start: 0, end: text.length, cursor: 0, out: '', style: (part) => part },
  ];
  for (let index = 0; ; ) {
    const frame = frames.at(-1)!;
    if (index >= frame.end) {
      const done = frame.style(frame.out + text.slice(frame.cursor, frame.end));
      frames.pop();
      const parent = frames.at(-1);
      if (isUndefined(parent)) return done;
      parent.out += done;
      index = parent.cursor = frame.end + 2;
      continue;
    }
    const after = markupEnd(index, frame.start, frame.end);
    if (isUndefined(after)) {
      index++;
      continue;
    }
    const char = masked[index];
    frame.out += text.slice(frame.cursor, index);
    if (char === '`') {
      frame.out += highlight(codeSpanText(text.slice(index, after)));
      index = frame.cursor = after;
      continue;
    }
    const style = char === '*' ? colors.bold : colors.dim;
    frames.push({ start: index + 2, end: after - 2, cursor: index + 2, out: '', style });
    index += 2;
  }
}
