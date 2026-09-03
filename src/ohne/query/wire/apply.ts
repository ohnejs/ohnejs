import type { LocaleCode } from '../../collections/known-locales.ts';
import type { CollectionQueryMeta } from '../metadata.ts';
import type { ConditionInput, UntypedQueryBuilder } from '../untyped.ts';
import type { ParsedQuery } from './parse.ts';

import { intersection, isNull, isUndefined, mapValues } from '../../../utils/index.ts';

/**
 * The endpoint-installed scope a wire query composes onto, narrowing what a request may read.
 *
 * The scope is trusted; the wire params are not.
 * Filters AND together, so a request can only narrow.
 * Selected fields intersect, so a request never widens past the scope; the row cap takes the smaller.
 */
export interface QueryScope {
  /**
   * A filter every request is ANDed under, so no request escapes the scope's rows.
   * A condition over translatable fields reads at the request's chosen locale.
   *
   * @example
   * ```ts
   * { published: true }
   * ```
   */
  where?: ConditionInput;

  /**
   * The fields a request may read; a request's own `select` intersects with these, never widening.
   * Parsed against `scopedMetadata`, a field outside them is refused wherever a read could address it.
   */
  select?: string[];

  /**
   * A row cap a request cannot exceed; the effective limit is the smaller of this and the request's.
   * Caps only the `limit`/`offset` window; a paginated read sizes by `perPage` under `guards.maxPerPage`.
   */
  limit?: number;

  /**
   * The locale the endpoint reads when the request names none; a request's `locale` param wins.
   */
  locale?: LocaleCode;
}

/**
 * Replays a parsed wire query onto a builder, composing it under an optional endpoint scope.
 *
 * The parsed query drives the same untyped methods the fluent builder narrows, so both paths compile alike.
 * The locale applies first, the request's choice over the scope's, then the filters replay.
 * The terminal stays with the caller, which pins `findMany`/`paginate`/... and runs it.
 * It reads `parsed.page`/`parsed.perPage` when it paginates.
 * Returns the builder for the terminal to run.
 *
 * @example
 * ```ts
 * const parsed = parseQueryParams(useSearchParams(), meta, resolveGuards())
 * const rows = await applyQuery(queryUntyped('Posts'), parsed, {
 *   where: { published: true },
 * }).findMany()
 * ```
 */
export function applyQuery(
  builder: UntypedQueryBuilder,
  parsed: ParsedQuery,
  scope: QueryScope = {},
): UntypedQueryBuilder {
  const locale = parsed.locale ?? scope.locale;
  if (!isUndefined(locale)) builder.locale(locale);
  if (!isUndefined(scope.where)) builder.where(scope.where);
  if (!isNull(parsed.where)) builder.where(parsed.where);
  const select = composeSelect(scope.select, parsed.select);
  if (!isNull(select)) builder.select(...select);
  for (const { field, direction } of parsed.order) builder.orderBy(field, direction);
  if (parsed.populate.length > 0) builder.populate(...parsed.populate);
  const limit = composeLimit(scope.limit, parsed.limit);
  if (!isNull(limit)) builder.limit(limit);
  if (!isNull(parsed.offset)) builder.offset(parsed.offset);
  return builder;
}

/**
 * The metadata a scoped wire query parses against: a field outside the scope's `select` reads as hidden.
 * The parser then refuses it in `where`, `order`, `select`, and `populate` exactly as an unknown field.
 * A scope without `select` parses against the metadata as is.
 *
 * @example
 * ```ts
 * const parsed = parseQueryParams(useSearchParams(), scopedMetadata(meta, scope), resolveGuards())
 * ```
 */
export function scopedMetadata(meta: CollectionQueryMeta, scope: QueryScope): CollectionQueryMeta {
  if (isUndefined(scope.select)) return meta;
  const visible = new Set(scope.select);
  return {
    ...meta,
    fields: mapValues(meta.fields, (name, entry) =>
      visible.has(name) ? entry : { ...entry, readable: false as const },
    ),
  };
}

/**
 * Composes an endpoint scope onto a builder, with no wire query to replay.
 * The scope's locale, filter, fields, and row cap apply as they are.
 * The counterpart of `applyQuery` for a query app code writes itself under an operation's `access`.
 *
 * @example
 * ```ts
 * const posts = await applyScope(queryUntyped('Posts'), { where: { published: true } }).findMany()
 * ```
 */
export function applyScope(builder: UntypedQueryBuilder, scope: QueryScope): UntypedQueryBuilder {
  if (!isUndefined(scope.locale)) builder.locale(scope.locale);
  if (!isUndefined(scope.where)) builder.where(scope.where);
  if (!isUndefined(scope.select)) builder.select(...scope.select);
  if (!isUndefined(scope.limit)) builder.limit(scope.limit);
  return builder;
}

/**
 * The fields the read narrows to: the scope's when the request names none, else their intersection.
 * An empty intersection keeps the scope, so a request that names only out-of-scope fields never widens.
 */
function composeSelect(scope: string[] | undefined, user: string[] | null): string[] | null {
  if (isUndefined(scope)) return user;
  if (isNull(user)) return scope;
  const shared = intersection(scope, user);
  return shared.length > 0 ? shared : scope;
}

/**
 * The effective row cap: the smaller of the scope's and the request's, or whichever one is set.
 */
function composeLimit(scope: number | undefined, user: number | null): number | null {
  if (isUndefined(scope)) return user;
  if (isNull(user)) return scope;
  return Math.min(scope, user);
}
