import type { MessageAST } from '../../utils/i18n/message-ast.ts';
import type { KnownMessages } from './known-messages.ts';

import { formatMessageAST } from '../../utils/i18n/format-message-ast.ts';
import { messageGroup } from '../../utils/i18n/message-group.ts';
import { parseMessage } from '../../utils/i18n/parse-message.ts';
import { isUndefined } from '../../utils/is/is-undefined.ts';
import { messageCatalog } from './messages.ts';
import { useDashboardLanguage } from './use-dashboard-language.ts';

/**
 * Value types a message parameter may take, matching the Node-side `MessageParams`.
 */
export type MessageParams = Record<string, string | number | Date>;

/**
 * Translates a known message key to a string in the dashboard's active language.
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
 * Returns a translator bound to the dashboard's reactive language.
 *
 * The returned `t` reads `useDashboardLanguage` and the message store on every call.
 * Calling it inside a reactive render keeps the string live.
 * It re-renders when the language changes or when the key's catalog finishes loading.
 * The catalog is fetched from the API on demand, once per group and language.
 *
 * A key whose catalog has not loaded yet, or that no language defines, renders as the key itself.
 * Templates are parsed once and cached.
 * A fallback-filled message keeps its origin language, so its plural and number rules match the text.
 *
 * @example
 * ```ts
 * const t = useT()
 *
 * h('h1', null, () => t('page.title'))
 * h('p', null, () => t('field.minLength', { min: 3 }))
 * ```
 */
export function useT(): Translate {
  return ((key: string, params?: MessageParams) => translate(key, params)) as Translate;
}

/**
 * Formats `key` from its loaded catalog entry, or answers the key itself when there is none.
 */
function translate(key: string, params: MessageParams | undefined): string {
  const language = useDashboardLanguage().value;
  const catalog = messageCatalog(language, messageGroup(key));
  const entry = catalog?.[key];
  if (isUndefined(entry)) return key;
  return formatMessageAST(astOf(entry.template), params, entry.language);
}

/**
 * Parses a template on first use and answers the cached AST from then on.
 */
function astOf(template: string): MessageAST {
  let ast = cache.get(template);
  if (isUndefined(ast)) {
    ast = parseMessage(template);
    cache.set(template, ast);
  }
  return ast;
}
