import { clamp } from '../number/clamp.ts';

/**
 * Thrown by `parseMessage` when the template violates ICU MessageFormat grammar.
 * Carries the character offset, a 1-indexed line/column, and a snippet with a caret.
 * The snippet is appended to `message` so an uncaught throw prints a useful diagnostic.
 *
 * @example
 * ```ts
 * try { parseMessage('Hello }'); }
 * catch (e) {
 *   e.position // -> 6
 *   e.line     // -> 1
 *   e.column   // -> 7
 *   e.snippet  // -> "Hello }\n      ^"
 * }
 * ```
 */
export class MessageSyntaxError extends Error {
  /**
   * Zero-indexed character offset into the template.
   */
  readonly position: number;

  /**
   * One-indexed line number.
   */
  readonly line: number;

  /**
   * One-indexed column number.
   */
  readonly column: number;

  /**
   * Multi-line snippet showing the offending line and a caret under the offending column.
   */
  readonly snippet: string;

  constructor(message: string, template: string, position: number) {
    const { line, column, snippet } = locate(template, position);
    super(`${message} (${line}:${column})\n${snippet}`);
    this.name = 'MessageSyntaxError';
    this.position = position;
    this.line = line;
    this.column = column;
    this.snippet = snippet;
  }
}

/**
 * Thrown by `formatMessage` and `formatMessageAST` when rendering hits a feature with no `Intl` mapping.
 * Examples: a skeleton stem like `permille`, the bare `currency` predefined style.
 * Soft failures (missing param, uncoercible value) never throw.
 * They call `onError` and emit a fallback render instead.
 *
 * @example
 * ```ts
 * try { formatMessage('{n, number, currency}', { n: 5 }, 'en'); }
 * catch (e) {
 *   e instanceof MessageFormatError // -> true
 *   e.message                       // -> "bare `currency` style requires a code; use `::currency/XXX` skeleton instead"
 * }
 * ```
 */
export class MessageFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MessageFormatError';
  }
}

function locate(
  template: string,
  position: number,
): { line: number; column: number; snippet: string } {
  const clamped = clamp(position, 0, template.length);
  let line = 1;
  let lineStart = 0;

  for (let i = 0; i < clamped; i++) {
    if (template.charCodeAt(i) === 10) {
      line++;
      lineStart = i + 1;
    }
  }

  const column = clamped - lineStart + 1;
  const nl = template.indexOf('\n', lineStart);
  const lineEnd = nl === -1 ? template.length : nl;
  const source = template.slice(lineStart, lineEnd);
  const caret = ' '.repeat(column - 1) + '^';

  return { line, column, snippet: `${source}\n${caret}` };
}
