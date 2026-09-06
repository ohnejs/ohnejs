import type { MessageAST } from '../../utils/index.ts';
import type { Message } from '../messages/known-messages.ts';

import {
  canonicalizeLanguage,
  formatMessageAST,
  isString,
  isUndefined,
  languageFallbacks,
  parseMessage,
  uniqueArray,
} from '../../utils/index.ts';
import { DEFAULTS } from '../layers/config.ts';
import { useConfig } from '../layers/use-config.ts';
import { useMessages } from '../messages/use-messages.ts';
import { useAcceptsLanguages } from './use-accepts-languages.ts';
import { tryUseEvent } from './use-event.ts';

declare module 'ohne' {
  interface EventContext {
    /**
     * Active language for the request, as a BCP-47 tag.
     * `useT` reads it first, before negotiating `Accept-Language`.
     * Set it from a middleware to force the language: from a cookie, a route segment, or a user setting.
     *
     * Setting it skips `Accept-Language` negotiation, so no `Vary` is added.
     */
    locale?: string;
  }
}

/**
 * Value types a message parameter may take.
 */
export type MessageParams = Record<string, string | number | Date>;

const cache = new Map<string, MessageAST>();

/**
 * Translates a message key in the request's active language, loosely typed for framework-internal use.
 *
 * Unlike `useT`, the key is a plain `string`, so core code may use keys `KnownMessages` does not declare.
 * It is safe outside a request too: with no bound event it resolves the default language.
 * A key absent from every language renders as the key itself.
 *
 * @example
 * ```ts
 * translate('api.http.notFound')
 * // -> 'Not Found'
 *
 * translate('api.messages.unknownGroup', { group: 'x' })
 * // -> 'Unknown message group `x`'
 * ```
 */
export function translate(key: string, params?: MessageParams): string {
  return translateIn(key, activeLanguage(), params);
}

/**
 * Resolves a `Message` to a display string in the request's active language.
 *
 * A `{ key, params }` object resolves with its parameters.
 * A key or plain string resolves through `translate`.
 * A string matching no catalog key returns unchanged, so an already-resolved message passes through.
 *
 * @example
 * ```ts
 * resolveMessage('validation.required')
 * // -> 'This field is required'
 *
 * resolveMessage({ key: 'api.messages.unknownGroup', params: { group: 'x' } })
 * // -> 'Unknown message group `x`'
 * ```
 */
export function resolveMessage(message: Message): string {
  return isString(message)
    ? translate(message)
    : translate(message.key, message.params as MessageParams);
}

/**
 * Translates `key` into an explicit `language`, the shared core of `translate` and `useT`.
 */
export function translateIn(key: string, language: string, params?: MessageParams): string {
  const found = lookup(key, language);
  return isUndefined(found) ? key : formatMessageAST(astOf(found.template), params, found.language);
}

/**
 * Resolves the request's active language, falling back to the default language outside a request.
 * Inside a request it is `context.locale` when set, otherwise the best `Accept-Language` match.
 * A request with no `Accept-Language` resolves to the default, not whatever the catalog lists first.
 */
export function activeLanguage(): string {
  const fallback = defaultLanguage();
  const event = tryUseEvent();
  if (isUndefined(event)) return fallback;
  if (!isUndefined(event.context.locale))
    return canonicalizeLanguage(event.context.locale) ?? fallback;
  // Offer the default first, so no `Accept-Language` (or a bare `*`) resolves to it, not catalog order.
  const offered = uniqueArray([fallback, ...Object.keys(useMessages().all())]);
  return useAcceptsLanguages(offered) ?? fallback;
}

/**
 * Resolves the app's default language as a canonical BCP-47 tag: `messages.defaultLanguage`, or `en`.
 * A configured tag that does not canonicalize is answered as written, so a bad config stays visible.
 *
 * @example
 * ```ts
 * defaultLanguage() // -> 'en'
 * ```
 */
export function defaultLanguage(): string {
  const configured = useConfig().messages?.defaultLanguage ?? DEFAULTS.messages.defaultLanguage;
  return canonicalizeLanguage(configured) ?? configured;
}

function lookup(key: string, language: string): { template: string; language: string } | undefined {
  const catalogs = useMessages().all();
  for (const lang of uniqueArray([...languageFallbacks(language), defaultLanguage()])) {
    const template = catalogs[lang]?.[key];
    if (!isUndefined(template)) return { template, language: lang };
  }
  return undefined;
}

function astOf(template: string): MessageAST {
  let ast = cache.get(template);
  if (isUndefined(ast)) {
    ast = parseMessage(template);
    cache.set(template, ast);
  }
  return ast;
}
