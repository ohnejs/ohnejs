import { codeSpan } from '../ansi/code-span.ts';
import { escapeControls } from '../ansi/escape-controls.ts';
import { clamp } from '../number/clamp.ts';

/**
 * Thrown by `parseMessage` when the template violates ICU MessageFormat grammar.
 * Carries the character offset, a 1-indexed line/column, and a snippet with a caret.
 * The snippet is appended to `message`, its source line fenced so the printer echoes it exactly.
 *
 * @example
 * ```ts
 * try { parseMessage('Hello }') }
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
    const { line, column, source, caret } = locate(template, position);
    super(`${message} (${line}:${column})\n${codeSpan(source)}\n${caret}`);
    this.name = 'MessageSyntaxError';
    this.position = position;
    this.line = line;
    this.column = column;
    this.snippet = `${source}\n${caret}`;
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
 * try { formatMessage('{n, number, currency}', { n: 5 }, 'en') }
 * catch (e) {
 *   e instanceof MessageFormatError // -> true
 *   e.message                       // -> "bare `currency` style requires a code; ..."
 * }
 * ```
 */
export class MessageFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MessageFormatError';
  }
}

/**
 * Resolves an offset, clamped into the template, to its 1-indexed line and column, source line, and caret.
 * The source line spells out its control characters, and the caret counts their escapes.
 */
function locate(
  template: string,
  position: number,
): { line: number; column: number; source: string; caret: string } {
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
  const source = escapeControls(template.slice(lineStart, lineEnd));
  const caret = ' '.repeat(escapeControls(template.slice(lineStart, clamped)).length) + '^';

  return { line, column, source, caret };
}
