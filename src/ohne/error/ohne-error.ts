import { hasKey, isString, isUndefined } from '../../utils/index.ts';

/**
 * A rich failure to throw, rendered as an error block by `reportError`.
 */
export interface OhneErrorInit {
  /**
   * The headline.
   * Sentence case, no trailing period; backtick the offending identifier or value.
   */
  title: string;

  /**
   * The cause and the fix, one sentence per row.
   * Pass an array of sentences; the reporter joins them with newlines.
   */
  body?: string | string[];

  /**
   * Reference location as `file:line:col`, shown in the block's corner.
   */
  path?: string;
}

/**
 * A branded `Error` the error funnel knows how to render.
 *
 * A bare-message error carries no `title` or `path` and renders as a single line.
 * One built from an `OhneErrorInit` carries them and renders as a block.
 */
export interface OhneError extends Error {
  /**
   * The headline, set when the error was built as a block.
   */
  title?: string;

  /**
   * The body sentences, when set.
   */
  body?: string | string[];

  /**
   * Reference location as `file:line:col`, when known.
   */
  path?: string;
}

const OHNE_ERROR = Symbol('ohne.error');

/**
 * Builds a branded `Error` for a failure ohne can explain.
 *
 * Pass a string for a one-line failure, or an `OhneErrorInit` for a titled block.
 * `reportError` renders it; `throw`, `instanceof Error`, and `.message` all work as usual.
 *
 * @example
 * ```ts
 * throw ohneError('Project has no routes')
 * throw ohneError({ title: 'Invalid `port`', body: ['`port` must be 0-65535.', 'You set `99999`.'] })
 * ```
 */
export function ohneError(input: string | OhneErrorInit): OhneError {
  const error = new Error(isString(input) ? input : input.title) as OhneError;
  Object.defineProperty(error, OHNE_ERROR, { value: true });
  if (!isString(input)) {
    error.title = input.title;
    if (!isUndefined(input.body)) error.body = input.body;
    if (!isUndefined(input.path)) error.path = input.path;
  }
  return error;
}

/**
 * Whether `value` is an `ohneError`.
 *
 * @example
 * ```ts
 * isOhneError(ohneError('x')) // -> true
 * isOhneError(new Error('x')) // -> false
 * ```
 */
export function isOhneError(value: unknown): value is OhneError {
  return value instanceof Error && hasKey(value, OHNE_ERROR);
}
