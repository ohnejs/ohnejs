import type {
  ArgumentNode,
  DateNode,
  MessageAST,
  Node,
  NumberNode,
  PluralCase,
  PluralNode,
  SelectCase,
  SelectNode,
  TimeNode,
} from './ast.ts';

import { coerceToDate } from '../coerce/coerce-to-date.ts';
import { coerceToNumber } from '../coerce/coerce-to-number.ts';
import { isDate } from '../is/is-date.ts';
import { isNull } from '../is/is-null.ts';
import { isNullish } from '../is/is-nullish.ts';
import { isNumber } from '../is/is-number.ts';
import { hasKey } from '../object/has-key.ts';
import { MessageFormatError } from './errors.ts';
import { dateOptionsFromSkeleton } from './skeleton-date.ts';
import { numberOptionsFromSkeleton } from './skeleton-number.ts';

type Context = {
  params: Record<string, unknown> | undefined;
  language: string;
  onError: ((error: MessageFormatError) => void) | undefined;
  pound: { value: number; offset: number } | null;
};

/**
 * Options accepted by `format`.
 */
export interface FormatOptions {
  /**
   * Hook invoked on every soft format failure.
   * Soft failures: a missing parameter, an uncoercible value, a plural with no keyword match.
   * The default is a no-op; `format` emits the fallback render and keeps going.
   * Throw from `onError` to opt into strict mode.
   *
   * @default
   * undefined
   */
  onError?: (error: MessageFormatError) => void;
}

const DATETIME_STYLE_KEYWORDS: ReadonlySet<string> = new Set(['short', 'medium', 'long', 'full']);

/**
 * Renders a parsed `MessageAST` against `params` in `language`.
 *
 * Soft failures (missing param, uncoercible value) call `onError`.
 * Simple, `number`, `date`, `time` args render the `{name}` placeholder.
 * `plural` and `select` fall through to the `other` branch.
 *
 * Hard failures (unsupported skeleton stem, bare `currency` style) throw `MessageFormatError`.
 *
 * `Intl.NumberFormat`, `Intl.DateTimeFormat`, and `Intl.PluralRules` are constructed per call.
 * This module holds no internal cache.
 *
 * @example
 * ```ts
 * format(parse('Hello {name}!'), { name: 'World' }, 'en')
 * // -> 'Hello World!'
 *
 * format(
 *   parse('{n, plural, one {# item} other {# items}}'),
 *   { n: 3 },
 *   'en',
 * )
 * // -> '3 items'
 * ```
 */
export function format(
  ast: MessageAST,
  params: Record<string, unknown> | undefined,
  language: string,
  options?: FormatOptions,
): string {
  return renderNodes(ast, {
    params,
    language,
    onError: options?.onError,
    pound: null,
  });
}

function renderNodes(nodes: MessageAST, ctx: Context): string {
  let out = '';
  for (const node of nodes) out += renderNode(node, ctx);
  return out;
}

function renderNode(node: Node, ctx: Context): string {
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

function renderArgument(node: ArgumentNode, ctx: Context): string {
  const value = lookup(node.name, ctx);
  if (isNullish(value)) return missing(node.name, ctx);
  return String(value);
}

function renderNumber(node: NumberNode, ctx: Context): string {
  const value = lookup(node.name, ctx);
  if (isNullish(value)) return missing(node.name, ctx);
  const coerced = coerceToNumber(value);
  const num = isNumber(coerced) ? coerced : Number(value);
  if (Number.isNaN(num)) return missing(node.name, ctx);
  return numberFormat(node.style, ctx.language).format(num);
}

function renderDate(node: DateNode, ctx: Context): string {
  const value = lookup(node.name, ctx);
  if (isNullish(value)) return missing(node.name, ctx);
  const date = coerceToDate(value);
  if (!isDate(date)) return missing(node.name, ctx);
  return dateFormat(node.style, ctx.language).format(date);
}

function renderTime(node: TimeNode, ctx: Context): string {
  const value = lookup(node.name, ctx);
  if (isNullish(value)) return missing(node.name, ctx);
  const date = coerceToDate(value);
  if (!isDate(date)) return missing(node.name, ctx);
  return timeFormat(node.style, ctx.language).format(date);
}

function renderPlural(node: PluralNode, ctx: Context): string {
  const value = pluralValue(node, ctx);
  const adjusted = value - node.offset;
  const chosen = matchPluralCase(node, value, adjusted, ctx.language);
  return renderNodes(chosen.body, { ...ctx, pound: { value, offset: node.offset } });
}

function renderSelect(node: SelectNode, ctx: Context): string {
  const value = lookup(node.name, ctx);
  const nullish = isNullish(value);
  if (nullish) notify(ctx, `missing parameter \`${node.name}\``);
  const chosen = matchSelectCase(node.cases, nullish ? '' : String(value));
  return renderNodes(chosen.body, ctx);
}

function renderPound(ctx: Context): string {
  if (!ctx.pound) return '#';
  const adjusted = ctx.pound.value - ctx.pound.offset;
  return new Intl.NumberFormat(ctx.language).format(adjusted);
}

function pluralValue(node: PluralNode, ctx: Context): number {
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

function matchPluralCase(
  node: PluralNode,
  raw: number,
  adjusted: number,
  language: string,
): PluralCase {
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

function matchSelectCase(cases: readonly SelectCase[], key: string): SelectCase {
  for (const c of cases) if (c.keyword === key) return c;
  return cases.find((c) => c.keyword === 'other')!;
}

function lookup(name: string, ctx: Context): unknown {
  if (!ctx.params) return undefined;
  if (!hasKey(ctx.params, name)) return undefined;
  return ctx.params[name];
}

function missing(name: string, ctx: Context): string {
  notify(ctx, `missing parameter \`${name}\``);
  return `{${name}}`;
}

function notify(ctx: Context, message: string): void {
  if (ctx.onError) ctx.onError(new MessageFormatError(message));
}

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
