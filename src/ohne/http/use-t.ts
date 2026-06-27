import type { MessageAST } from '../../utils/index.ts';
import type { KnownMessages } from '../messages/known-messages.ts';

import {
  canonicalizeLanguage,
  formatMessageAST,
  isUndefined,
  languageFallbacks,
  parseMessage,
  uniqueArray,
} from '../../utils/index.ts';
import { useConfig } from '../layers/use-config.ts';
import { useMessages } from '../messages/use-messages.ts';
import { useAcceptsLanguages } from './use-accepts-languages.ts';
import { useEvent } from './use-event.ts';

declare module 'ohne' {
  interface EventContext {
    /**
     * Active language for the request, as a BCP-47 tag.
     * `useT` reads it first, before negotiating `Accept-Language`.
     * Set it from a middleware to force the language: from a cookie, a route segment, or a user setting.
     */
    locale?: string;
  }
}

/**
 * Value types a message parameter may take.
 */
export type MessageParams = Record<string, string | number | Date>;

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

const cache = new Map<string, MessageAST>();

/**
 * Returns a translator bound to the request's active language.
 *
 * The language is `context.locale` when a middleware set it.
 * Otherwise it is the best `Accept-Language` match, then the configured `messages.defaultLanguage`.
 * A missing key is filled from a less specific language: `de-AT` falls back to `de`, then the default.
 * It is formatted in the language it was found in, so its plural and number rules match the text.
 * A key absent from every fallback renders as the key itself.
 *
 * Valid only within a request.
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
  const t = (key: string, params?: MessageParams): string => {
    const found = lookup(key, language);
    return isUndefined(found)
      ? key
      : formatMessageAST(astOf(found.template), params, found.language);
  };
  return t as Translate;
}

function activeLanguage(): string {
  const fallback = defaultLanguage();
  const explicit = useEvent().context.locale;
  if (!isUndefined(explicit)) return canonicalizeLanguage(explicit) ?? fallback;
  return useAcceptsLanguages(Object.keys(useMessages().all())) ?? fallback;
}

function lookup(key: string, language: string): { template: string; language: string } | undefined {
  const catalogs = useMessages().all();
  for (const lang of uniqueArray([...languageFallbacks(language), defaultLanguage()])) {
    const template = catalogs[lang]?.[key];
    if (!isUndefined(template)) return { template, language: lang };
  }
  return undefined;
}

function defaultLanguage(): string {
  const configured = useConfig().messages.defaultLanguage;
  return canonicalizeLanguage(configured) ?? configured;
}

function astOf(template: string): MessageAST {
  let ast = cache.get(template);
  if (isUndefined(ast)) {
    ast = parseMessage(template);
    cache.set(template, ast);
  }
  return ast;
}
