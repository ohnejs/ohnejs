import type { Text } from './text-type.ts';

import { formatMessage } from '../../utils/i18n/format-message.ts';
import { isFunction } from '../../utils/is/is-function.ts';
import { translateMessage } from './use-t.ts';

export type { Text } from './text-type.ts';

/**
 * Resolves `Text` to a string in the dashboard's active language.
 * A key no catalog defines renders as itself, so plain text passes through.
 * The read is reactive: inside a function child it follows the language and the getter's refs.
 *
 * @example
 * ```ts
 * h('h2', null, () => resolveText('dashboard.overview.title'))
 * // -> <h2>Overview</h2>
 * ```
 */
export function resolveText(text: Text): string {
  return isFunction<() => string>(text) ? text() : translateMessage(text);
}

/**
 * Translates a kit string's message key, or formats `fallback` when no loaded catalog defines it.
 * `fallback` is the English ICU template, so `params` fill it exactly as they fill a catalog entry.
 * Without the base layer's catalogs the kit still reads in plain English.
 * The read is reactive, exactly as `resolveText` is.
 *
 * @example
 * ```ts
 * defaultText('dashboard.retry', 'Retry')                           // -> 'Retry'
 * defaultText('dashboard.versus', 'vs {value}', { value: '1,204' }) // -> 'vs 1,204'
 * ```
 */
export function defaultText(
  key: string,
  fallback: string,
  params?: Record<string, unknown>,
): string {
  const text = translateMessage({ key, params });
  return text === key ? formatMessage(fallback, params, 'en') : text;
}
