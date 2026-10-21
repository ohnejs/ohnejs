import type { MessageAST } from '../../utils/i18n/message-ast.ts';
import type { MessageParams } from '../../utils/i18n/message-params.ts';
import type { KnownMessages } from './known-messages.ts';
import type { Text } from './text-type.ts';

import { formatMessageAST } from '../../utils/i18n/format-message-ast.ts';
import { messageGroup } from '../../utils/i18n/message-group.ts';
import { parseMessage } from '../../utils/i18n/parse-message.ts';
import { isFunction } from '../../utils/is/is-function.ts';
import { isPlainObject } from '../../utils/is/is-plain-object.ts';
import { isString } from '../../utils/is/is-string.ts';
import { isUndefined } from '../../utils/is/is-undefined.ts';
import { dashboardConfig } from './config.ts';
import { messageCatalog } from './messages.ts';
import { useDashboardLanguage } from './use-dashboard-language.ts';

export type { MessageParams };

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
let groups: ReadonlySet<string> | undefined;

/**
 * Returns a translator bound to the dashboard's reactive language.
 *
 * The returned `t` reads `useDashboardLanguage` and the message store on every call.
 * Inside a function child the string stays live, following the language and a catalog that loads late.
 * Anywhere else a call is a snapshot: it renders once and never changes, since a page never rebuilds.
 * Any other language's catalog is fetched from the API on demand, once per group and language.
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
 * Translates a `Text`, like a discovery label that reached the client as plain data or a spec's own label.
 * A string resolves as a key, or stays itself when no catalog defines it.
 * A string outside every message group, like `Blog posts`, answers at once and fetches nothing.
 * A `{ key, params }` object formats, and a getter answers its own string.
 * Anything else answers `undefined`, so a caller can fall back.
 * The read is reactive, exactly as `useT` is, so call it inside a function child to stay live.
 *
 * @example
 * ```ts
 * translateMessage('dashboard.yes')
 * // -> 'Yes'
 *
 * translateMessage({ key: 'dashboard.foundErrors', params: { count: 2 } })
 * // -> 'Found 2 errors'
 *
 * translateMessage(() => `${count.value} selected`)
 * // -> '3 selected'
 *
 * translateMessage(42)
 * // -> undefined
 * ```
 */
export function translateMessage(message: Text): string;
export function translateMessage(message: unknown): string | undefined;
export function translateMessage(message: unknown): string | undefined {
  if (isString(message)) return translate(message, undefined);
  if (isFunction<() => string>(message)) return message();
  if (isPlainObject(message) && isString(message.key)) {
    return translate(message.key, message.params as MessageParams | undefined);
  }
  return undefined;
}

/**
 * Formats `key` from its loaded catalog entry, or answers the key itself when there is none.
 * A key outside every group the stack defines is plain text, so it never fetches a catalog.
 */
function translate(key: string, params: MessageParams | undefined): string {
  const group = messageGroup(key);
  groups ??= new Set(dashboardConfig().messageGroups);
  if (!groups.has(group)) return key;
  const language = useDashboardLanguage().value;
  const catalog = messageCatalog(language, group);
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
