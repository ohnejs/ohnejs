import type {
  MessageArgumentNode,
  MessageAST,
  MessageDateNode,
  MessageNode,
  MessageNumberNode,
  MessagePluralCase,
  MessagePluralNode,
  MessageSelectCase,
  MessageSelectNode,
  MessageTimeNode,
} from './message-ast.ts';

import { coerceToDate } from '../coerce/coerce-to-date.ts';
import { coerceToNumber } from '../coerce/coerce-to-number.ts';
import { isDate } from '../is/is-date.ts';
import { isNull } from '../is/is-null.ts';
import { isNullish } from '../is/is-nullish.ts';
import { isNumber } from '../is/is-number.ts';
import { hasKey } from '../object/has-key.ts';
import { dateOptionsFromSkeleton } from './date-options-from-skeleton.ts';
import { MessageFormatError } from './message-errors.ts';
import { numberOptionsFromSkeleton } from './number-options-from-skeleton.ts';

type Context = {
  params: Record<string, unknown> | undefined;
  language: string;
  onError: ((error: MessageFormatError) => void) | undefined;
  pound: { value: number; offset: number } | null;
};

/**
 * Options accepted by `formatMessageAST`.
 */
export interface FormatMessageOptions {
  /**
   * Hook invoked on every soft format failure.
   * Soft failures: a missing parameter, or a value that cannot be coerced to the argument's type.
   * The default is a no-op; `formatMessageAST` emits the fallback render and keeps going.
   * Throw from `onError` to opt into strict mode.
   */
  onError?: (error: MessageFormatError) => void;
}

const DATETIME_STYLE_KEYWORDS: ReadonlySet<string> = new Set(['short', 'medium', 'long', 'full']);

/**
 * Renders a parsed `MessageAST` against `params` in `language`.
 *
 * Soft failures (missing param, uncoercible value) call `onError`.
 * Simple, `number`, `date`, `time` args render the `{name}` placeholder.
 * `select` falls through to the `other` branch.
 * `plural` renders the value `0`, so an `=0` exact or the locale's category case wins before `other`.
 *
 * Hard failures (unsupported skeleton stem, bare `currency` style) throw `MessageFormatError`.
 *
 * `Intl.NumberFormat`, `Intl.DateTimeFormat`, and `Intl.PluralRules` are constructed per call.
 * This module holds no internal cache.
 *
 * @example
 * ```ts
 * formatMessageAST(parseMessage('Hello {name}!'), { name: 'World' }, 'en')
 * // -> 'Hello World!'
 *
 * formatMessageAST(
 *   parseMessage('{n, plural, one {# item} other {# items}}'),
 *   { n: 3 },
 *   'en',
 * )
 * // -> '3 items'
 * ```
 */
export function formatMessageAST(
  ast: MessageAST,
  params: Record<string, unknown> | undefined,
  language: string,
  options?: FormatMessageOptions,
): string {
  return renderNodes(ast, {
    params,
    language,
    onError: options?.onError,
    pound: null,
  });
}

/**
 * Renders a node sequence into one string under one shared context.
 */
function renderNodes(nodes: MessageAST, ctx: Context): string {
  let out = '';
  for (const node of nodes) out += renderNode(node, ctx);
  return out;
}

/**
 * Dispatches a node to the renderer for its `kind`; a literal renders verbatim.
 */
function renderNode(node: MessageNode, ctx: Context): string {
  switch (node.kind) {
    case 'literal':
      return node.value;
    case 'argument':
      return renderArgument(node, ctx);
    case 'number':
      return renderNumber(node, ctx);
    case 'date':
      return renderDate(node, ctx);
    case 'time':
      return renderTime(node, ctx);
    case 'plural':
      return renderPlural(node, ctx);
    case 'select':
      return renderSelect(node, ctx);
    case 'pound':
      return renderPound(ctx);
  }
}

/**
 * Renders a simple argument as its string value, or its `{name}` placeholder when the param is missing.
 */
function renderArgument(node: MessageArgumentNode, ctx: Context): string {
  const value = lookup(node.name, ctx);
  if (isNullish(value)) return missing(node.name, ctx);
  return String(value);
}

/**
 * Formats a `number` argument by its style, or renders `{name}` when the param is missing or not numeric.
 */
function renderNumber(node: MessageNumberNode, ctx: Context): string {
  const value = lookup(node.name, ctx);
  if (isNullish(value)) return missing(node.name, ctx);
  const coerced = coerceToNumber(value);
  const num = isNumber(coerced) ? coerced : Number(value);
  if (Number.isNaN(num)) return missing(node.name, ctx);
  return numberFormat(node.style, ctx.language).format(num);
}

/**
 * Formats a `date` argument by its style, or renders `{name}` when the param does not coerce to a date.
 */
function renderDate(node: MessageDateNode, ctx: Context): string {
  const value = lookup(node.name, ctx);
  if (isNullish(value)) return missing(node.name, ctx);
  const date = coerceToDate(value);
  if (!isDate(date)) return missing(node.name, ctx);
  return dateFormat(node.style, ctx.language).format(date);
}

/**
 * Formats a `time` argument by its style, or renders `{name}` when the param does not coerce to a date.
 */
function renderTime(node: MessageTimeNode, ctx: Context): string {
  const value = lookup(node.name, ctx);
  if (isNullish(value)) return missing(node.name, ctx);
  const date = coerceToDate(value);
  if (!isDate(date)) return missing(node.name, ctx);
  return timeFormat(node.style, ctx.language).format(date);
}

/**
 * Renders the case the plural value selects, with `#` inside it bound to the value minus the offset.
 */
function renderPlural(node: MessagePluralNode, ctx: Context): string {
  const value = pluralValue(node, ctx);
  const adjusted = value - node.offset;
  const chosen = matchPluralCase(node, value, adjusted, ctx.language);
  return renderNodes(chosen.body, { ...ctx, pound: { value, offset: node.offset } });
}

/**
 * Renders the case matching the param's string value, or `other`, reporting a missing param.
 */
function renderSelect(node: MessageSelectNode, ctx: Context): string {
  const value = lookup(node.name, ctx);
  const nullish = isNullish(value);
  if (nullish) notify(ctx, `missing parameter \`${node.name}\``);
  const chosen = matchSelectCase(node.cases, nullish ? '' : String(value));
  return renderNodes(chosen.body, ctx);
}

/**
 * Formats `#` as the enclosing plural's value minus its offset, or a literal `#` outside any plural.
 */
function renderPound(ctx: Context): string {
  if (!ctx.pound) return '#';
  const adjusted = ctx.pound.value - ctx.pound.offset;
  return new Intl.NumberFormat(ctx.language).format(adjusted);
}

/**
 * Reads a plural param as a number, reporting it and falling back to `0` when missing or not numeric.
 */
function pluralValue(node: MessagePluralNode, ctx: Context): number {
  const raw = lookup(node.name, ctx);
  if (isNullish(raw)) {
    notify(ctx, `missing parameter \`${node.name}\``);
    return 0;
  }
  const coerced = coerceToNumber(raw);
  if (isNumber(coerced)) return coerced;
  const fallback = Number(raw);
  if (Number.isNaN(fallback)) {
    notify(ctx, `parameter \`${node.name}\` is not a number`);
    return 0;
  }
  return fallback;
}

/**
 * Picks the `=N` case equal to `raw`, else the case for the plural category of `adjusted`, else `other`.
 */
function matchPluralCase(
  node: MessagePluralNode,
  raw: number,
  adjusted: number,
  language: string,
): MessagePluralCase {
  for (const c of node.cases) {
    if (!isNull(c.exact) && c.exact === raw) return c;
  }
  const category = new Intl.PluralRules(language, {
    type: node.ordinal ? 'ordinal' : 'cardinal',
  }).select(adjusted);
  for (const c of node.cases) {
    if (isNull(c.exact) && c.keyword === category) return c;
  }
  return node.cases.find((c) => c.keyword === 'other')!;
}

/**
 * Picks the case whose keyword equals `key`, else `other`.
 */
function matchSelectCase(cases: readonly MessageSelectCase[], key: string): MessageSelectCase {
  for (const c of cases) if (c.keyword === key) return c;
  return cases.find((c) => c.keyword === 'other')!;
}

/**
 * Reads a param by own key, so inherited names like `toString` read as missing.
 */
function lookup(name: string, ctx: Context): unknown {
  if (!ctx.params) return undefined;
  if (!hasKey(ctx.params, name)) return undefined;
  return ctx.params[name];
}

/**
 * Reports a missing param and returns its `{name}` placeholder.
 */
function missing(name: string, ctx: Context): string {
  notify(ctx, `missing parameter \`${name}\``);
  return `{${name}}`;
}

/**
 * Reports a soft failure to `onError`, doing nothing when no handler is set.
 */
function notify(ctx: Context, message: string): void {
  if (ctx.onError) ctx.onError(new MessageFormatError(message));
}

/**
 * Builds the number formatter for no style, `integer`, `percent`, or a `::` skeleton; other styles throw.
 */
function numberFormat(style: string | null, language: string): Intl.NumberFormat {
  if (isNull(style)) return new Intl.NumberFormat(language);
  if (style === 'integer') return new Intl.NumberFormat(language, { maximumFractionDigits: 0 });
  if (style === 'percent') return new Intl.NumberFormat(language, { style: 'percent' });
  if (style === 'currency') {
    throw new MessageFormatError(
      'bare `currency` style requires a code; use `::currency/XXX` skeleton instead',
    );
  }
  if (style.startsWith('::')) {
    return new Intl.NumberFormat(language, numberOptionsFromSkeleton(style.slice(2)));
  }
  throw new MessageFormatError(`unknown number style \`${style}\``);
}

/**
 * Builds the date formatter for a style keyword or `::` skeleton, `medium` when unstyled; others throw.
 */
function dateFormat(style: string | null, language: string): Intl.DateTimeFormat {
  const key = style ?? 'medium';
  if (DATETIME_STYLE_KEYWORDS.has(key)) {
    return new Intl.DateTimeFormat(language, {
      dateStyle: key as 'short' | 'medium' | 'long' | 'full',
    });
  }
  if (!isNull(style) && style.startsWith('::')) {
    return new Intl.DateTimeFormat(language, dateOptionsFromSkeleton(style.slice(2)));
  }
  throw new MessageFormatError(`unknown date style \`${style}\``);
}

/**
 * Builds the time formatter for a style keyword or `::` skeleton, `medium` when unstyled; others throw.
 */
function timeFormat(style: string | null, language: string): Intl.DateTimeFormat {
  const key = style ?? 'medium';
  if (DATETIME_STYLE_KEYWORDS.has(key)) {
    return new Intl.DateTimeFormat(language, {
      timeStyle: key as 'short' | 'medium' | 'long' | 'full',
    });
  }
  if (!isNull(style) && style.startsWith('::')) {
    return new Intl.DateTimeFormat(language, dateOptionsFromSkeleton(style.slice(2)));
  }
  throw new MessageFormatError(`unknown time style \`${style}\``);
}
