import type { FormatMessageOptions } from './format-message-ast.ts';

import { formatMessageAST } from './format-message-ast.ts';
import { parseMessage } from './parse-message.ts';

/**
 * Parses `template` and formats it against `params` in `language`.
 * Convenience over `parseMessage` + `formatMessageAST`; parses on every call.
 * Reach for `createMessageFormatter` when rendering one template many times.
 *
 * @example
 * ```ts
 * formatMessage('Hello {name}!', { name: 'World' }, 'en')
 * // -> 'Hello World!'
 *
 * formatMessage('{n, plural, one {# item} other {# items}}', { n: 3 }, 'en')
 * // -> '3 items'
 * ```
 */
export function formatMessage(
  template: string,
  params: Record<string, unknown> | undefined,
  language: string,
  options?: FormatMessageOptions,
): string {
  return formatMessageAST(parseMessage(template), params, language, options);
}

/**
 * Curried translator bound to one BCP 47 language and one `FormatMessageOptions` set.
 * The returned function parses each call's template fresh; the module holds no AST cache.
 *
 * @example
 * ```ts
 * const t = createMessageFormatter('en-GB')
 * t('Hello {name}!', { name: 'World' }) // -> 'Hello World!'
 *
 * const strict = createMessageFormatter('en', { onError: (e) => { throw e } })
 * strict('Hello {name}!', {}) // -> throws MessageFormatError
 * ```
 */
export function createMessageFormatter(
  language: string,
  options?: FormatMessageOptions,
): (template: string, params?: Record<string, unknown>) => string {
  return (template, params) => formatMessage(template, params, language, options);
}
