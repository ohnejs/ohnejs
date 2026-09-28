import { stripVTControlCharacters } from 'node:util';

const WIDE =
  /[\p{Emoji_Presentation}\u1100-\u115F\u2E80-\u303E\u3041-\u33FF\u3400-\u4DBF\u4E00-\u9FFF\uA000-\uA4CF\uA960-\uA97F\uAC00-\uD7A3\uF900-\uFAFF\uFE10-\uFE19\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6\u{20000}-\u{3FFFD}]/u;
const ZERO_WIDTH = /[\p{Cc}\p{Cf}\p{Mn}\p{Me}]/u;

/**
 * Counts the terminal columns `text` fills, ignoring ANSI escape codes.
 * East Asian wide characters and emoji fill two columns, combining marks and control characters none.
 * Measures each code point on its own, so a sequence joined by a zero-width joiner counts every part.
 *
 * @example
 * ```ts
 * terminalWidth('abc')               // -> 3
 * terminalWidth('漢字')              // -> 4
 * terminalWidth('e\u0301')           // -> 1
 * terminalWidth('\x1b[1mab\x1b[22m') // -> 2
 * ```
 */
export function terminalWidth(text: string): number {
  let width = 0;
  for (const char of stripVTControlCharacters(text)) {
    if (WIDE.test(char)) width += 2;
    else if (!ZERO_WIDTH.test(char)) width += 1;
  }
  return width;
}
