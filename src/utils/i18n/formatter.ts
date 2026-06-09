import type { FormatOptions } from './format.ts';

import { format } from './format.ts';
import { parse } from './parse.ts';

/**
 * Parses `template` and formats it against `params` in `language`.
 * Convenience over `parse` + `format`; parses on every call.
 * Reach for `createFormatter` when rendering one template many times.
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
  options?: FormatOptions,
): string {
  return format(parse(template), params, language, options);
}

/**
 * Curried translator bound to one BCP 47 language and one `FormatOptions` set.
 * The returned function parses each call's template fresh; the module holds no AST cache.
 *
 * @example
 * ```ts
 * const t = createFormatter('en-GB');
 * t('Hello {name}!', { name: 'World' })
 * // -> 'Hello World!'
 *
 * const strict = createFormatter('en', { onError: (e) => { throw e } });
 * strict('Hello {name}!', {}) // -> throws MessageFormatError
 * ```
 */
export function createFormatter(
  language: string,
  options?: FormatOptions,
): (template: string, params?: Record<string, unknown>) => string {
  return (template, params) => formatMessage(template, params, language, options);
}
