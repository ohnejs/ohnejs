import { isUndefined } from '../is/is-undefined.ts';

/**
 * The backtick code spans of a text, found by `codeSpans`.
 */
export interface CodeSpans {
  /**
   * Maps the offset where each span opens to the offset just past its closing fence.
   */
  ends: Map<number, number>;

  /**
   * The text with each span's content blanked out, offsets unchanged.
   * A search over it never opens or closes other markup inside a span.
   */
  masked: string;
}

const BLANK = '\uE000';
const RUNS = /`+|\n/g;

/**
 * Finds the backtick code spans of `text` in linear time, as `codeSpan` writes them and Markdown reads them.
 * A span opens on a whole backtick run and closes at the next run of exactly that length on the same line.
 * Spans bind left to right, so a run inside an earlier span opens nothing.
 * With `escapes`, a backslash makes the next backtick literal, and the rest of its run may still open a span.
 *
 * @example
 * ```ts
 * codeSpans('a ``b`c`` d').ends  // -> Map { 2 => 9 }
 * codeSpans('``a`').ends         // -> Map {}
 * codeSpans('\\`a`', true).ends  // -> Map {}
 * codeSpans('\\``a`', true).ends // -> Map { 2 => 5 }
 * codeSpans('`*` *').masked      // -> '`\uE000` *'
 * ```
 */
export function codeSpans(text: string, escapes = false): CodeSpans {
  const runs = Array.from(text.matchAll(RUNS), ({ 0: run, index }) => [index, run.length] as const);
  const closers = new Map<number, number>();
  const shorterClosers = new Map<number, number>();
  const ahead = new Map<number, number>();
  for (const [start, length] of runs.toReversed()) {
    if (text[start] === '\n') ahead.clear();
    else {
      const closer = ahead.get(length);
      const shorter = ahead.get(length - 1);
      if (!isUndefined(closer)) closers.set(start, closer);
      if (!isUndefined(shorter)) shorterClosers.set(start, shorter);
      ahead.set(length, start);
    }
  }
  const ends = new Map<number, number>();
  let masked = '';
  let cursor = 0;
  for (const [run, length] of runs) {
    if (run < cursor) continue;
    const escaped = escapes && isEscaped(text, run);
    const closer = (escaped ? shorterClosers : closers).get(run);
    if (isUndefined(closer)) continue;
    const start = escaped ? run + 1 : run;
    const fence = run + length - start;
    const end = closer + fence;
    masked +=
      text.slice(cursor, start + fence) +
      BLANK.repeat(closer - start - fence) +
      text.slice(closer, end);
    ends.set(start, end);
    cursor = end;
  }
  return { ends, masked: masked + text.slice(cursor) };
}

/**
 * Whether an odd run of backslashes ends just before `index`, so the last of them escapes it.
 */
function isEscaped(text: string, index: number): boolean {
  let start = index;
  while (text[start - 1] === '\\') start--;
  return (index - start) % 2 === 1;
}
