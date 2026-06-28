import type { KnownMessages } from '../messages/known-messages.ts';

import { activeLanguage, type MessageParams, translateIn } from './translate.ts';

export type { MessageParams };

/**
 * Translates a known message key to a string in the request's active language.
 * After codegen the key must be one of `KnownMessages`, so an unknown key or typo is a compile error.
 * A key with parameters requires them, exactly typed; a key with none takes no second argument.
 * Before codegen, when no keys are known yet, any key and an optional parameter bag are accepted.
 */
export type Translate = [keyof KnownMessages] extends [never]
  ? (key: string, params?: MessageParams) => string
  : <K extends keyof KnownMessages>(key: K, ...args: ParamArgs<KnownMessages[K]>) => string;

type ParamArgs<P> = [keyof P] extends [never] ? [] : [params: P];

/**
 * Returns a translator bound to the request's active language.
 *
 * The language is `context.locale` when a middleware set it.
 * Otherwise it is the best `Accept-Language` match, then the configured `messages.defaultLanguage`.
 * A missing key is filled from a less specific language: `de-AT` falls back to `de`, then the default.
 * It is formatted in the language it was found in, so its plural and number rules match the text.
 * A key absent from every fallback renders as the key itself.
 *
 * Outside a request it resolves the default language.
 * Parsed templates are cached across requests, so each template parses once.
 *
 * @example
 * ```ts
 * const t = useT()
 *
 * t('field.required')              // -> 'This field is required'
 * t('field.minLength', { min: 3 }) // -> 'Must be at least 3 characters'
 * ```
 */
export function useT(): Translate {
  const language = activeLanguage();
  return ((key: string, params?: MessageParams) => translateIn(key, language, params)) as Translate;
}
