import type { ConditionNode, SearchParamValue } from '../../../utils/index.ts';
import type { OrderDirection, OrderEntry } from '../ir.ts';
import type { CollectionQueryMeta, FieldQueryMeta } from '../metadata.ts';
import type { ConditionInput } from '../untyped.ts';
import type { QueryGuards } from './guards.ts';

import {
  didYouMean,
  isArray,
  isBoolean,
  isNull,
  isNumber,
  isString,
  isUndefined,
  parseCondition,
  toArray,
  walkCondition,
} from '../../../utils/index.ts';
import { checkCondition, targetScope } from '../validate-condition.ts';
import {
  conditionShapeError,
  duplicateOrderFieldError,
  emptySelectError,
  invalidFieldError,
  invalidNumberError,
  invalidValueError,
  limitError,
  paginationError,
  unknownParamError,
} from './errors.ts';

/**
 * A validated query lifted off the wire, ready to replay through the untyped builder.
 *
 * `where` is the condition object the builder re-parses; `select` is `null` when unnarrowed.
 * `limit`/`offset` and `page`/`perPage` are the two windowing modes, never both set at once.
 * The endpoint pins the terminal, so it reads whichever pair its terminal consumes.
 */
export interface ParsedQuery {
  /**
   * The `where` condition, or `null` when the query names none.
   *
   * @example
   * ```ts
   * { status: 'published' }
   * ```
   */
  where: ConditionInput | null;

  /**
   * The fields to read, or `null` for the full record.
   */
  select: string[] | null;

  /**
   * The sort keys, in order; empty when the query names none.
   *
   * @example
   * ```ts
   * [{ field: 'views', direction: 'desc' }]
   * ```
   */
  order: OrderEntry[];

  /**
   * The relation fields to hydrate; empty when the query names none.
   */
  populate: string[];

  /**
   * The row cap, or `null` when unset.
   */
  limit: number | null;

  /**
   * The rows to skip, or `null` when unset.
   */
  offset: number | null;

  /**
   * The requested page, or `null` when unset.
   */
  page: number | null;

  /**
   * The requested page size, clamped to `maxPerPage`, or `null` when unset.
   */
  perPage: number | null;
}

const KNOWN_PARAMS = new Set([
  'where',
  'select',
  'order',
  'populate',
  'limit',
  'offset',
  'page',
  'perPage',
]);

/**
 * Parses and validates URL (or JSON-body) query parameters against a collection's metadata.
 *
 * Every failure throws an `HTTPError(400)` carrying a stable `code` and the offending dot `path`.
 * The condition parses through the shared grammar, then gates applicability, DoS ceilings, and value types.
 * `select`, `order`, and `populate` gate against the same fields; the two windowing modes are exclusive.
 * The untrusted path is the only one guard-checked; the fluent builder is not.
 *
 * @example
 * ```ts
 * // GET /posts?where={status:published}&select=[title]&limit=20
 * const parsed = parseQueryParams(
 *   useSearchParams(),
 *   queryMetadata('Posts'),
 *   resolveGuards(),
 * )
 *
 * parsed.select // -> ['title']
 * parsed.limit  // -> 20
 * ```
 */
export function parseQueryParams(
  params: Record<string, SearchParamValue>,
  meta: CollectionQueryMeta,
  guards: QueryGuards,
): ParsedQuery {
  for (const key of Object.keys(params)) {
    if (!KNOWN_PARAMS.has(key)) throw unknownParamError(key);
  }
  const window = parseWindow(params, guards);
  return Object.freeze({
    where: parseWhere(params.where, meta, guards, windowBoundParams(window)),
    select: parseSelect(params.select, meta, guards),
    order: parseOrder(params.order, meta, guards),
    populate: parsePopulate(params.populate, meta),
    ...window,
  });
}

/**
 * Parses the `where` condition through the shared grammar, then gates it against the collection.
 * Field applicability, the DoS ceilings, and value types are enforced in turn, each a distinct code.
 * `reserved` is the bound parameters the row window already claims, folded into the bound-param ceiling.
 */
function parseWhere(
  value: SearchParamValue | undefined,
  meta: CollectionQueryMeta,
  guards: QueryGuards,
  reserved: number,
): ConditionInput | null {
  if (isUndefined(value)) return null;
  const parsed = parseCondition(value);
  if (!parsed.ok) throw conditionShapeError(parsed.error);
  const problem = checkCondition(parsed.node, meta);
  if (!isNull(problem)) {
    throw invalidFieldError(problem.field, `where.${problem.path.join('.')}`, problem.suggestion);
  }
  enforceGuards(parsed.node, guards, reserved);
  checkValues(parsed.node, meta, []);
  return value as ConditionInput;
}

/**
 * Enforces the DoS ceilings over a condition: clause count, `has` nesting, list length, and value size.
 * None of these depend on the field scope, so one flat walk covers the whole tree.
 * The bound-param ceiling is aggregate; the per-key ceilings never sum toward it.
 * A fan of legal `in` lists is caught here, against a ceiling `resolveGuards` already clamped under the wall.
 */
function enforceGuards(node: ConditionNode, guards: QueryGuards, reserved: number): void {
  let conditions = 0;
  let boundParams = reserved;
  walkCondition(node, (child, info) => {
    if (child.kind === 'compare' || child.kind === 'has' || child.kind === 'empty') {
      conditions += 1;
      if (conditions > guards.maxConditions) {
        throw limitError('tooManyConditions', 'where', guards.maxConditions);
      }
    }
    if (info.hasDepth > guards.maxHasDepth)
      throw limitError('hasTooDeep', 'where', guards.maxHasDepth);
    if (child.kind !== 'compare' || isUndefined(child.value)) return;
    boundParams += isArray(child.value) ? child.value.length : 1;
    if (boundParams > guards.maxBoundParams) {
      throw limitError('tooManyBoundParams', 'where', guards.maxBoundParams);
    }
    const isList = child.op === 'in' || child.op === 'includesAll' || child.op === 'includesAny';
    if (isList && isArray(child.value) && child.value.length > guards.maxInLength) {
      throw limitError('listTooLong', 'where', guards.maxInLength);
    }
    const isPattern =
      child.op === 'contains' ||
      child.op === 'startsWith' ||
      child.op === 'endsWith' ||
      child.op === 'like';
    for (const item of toArray(child.value)) {
      if (!isString(item)) continue;
      const bytes = Buffer.byteLength(item, 'utf8');
      if (isPattern) {
        if (bytes > guards.maxPatternBytes)
          throw limitError('patternTooLarge', 'where', guards.maxPatternBytes);
      } else if (bytes > guards.maxValueBytes) {
        throw limitError('valueTooLarge', 'where', guards.maxValueBytes);
      }
    }
  });
}

/**
 * Checks each comparison value against its column's type, descending `has` scopes as the walk does.
 * Runs after applicability, so every leaf addresses a real field the current scope resolves.
 */
function checkValues(
  node: ConditionNode,
  meta: CollectionQueryMeta,
  prefix: readonly string[],
): void {
  if (node.kind === 'and' || node.kind === 'or') {
    for (const child of node.nodes) checkValues(child, meta, prefix);
    return;
  }
  if (node.kind === 'empty') return;
  const name = node.path[0];
  const field = meta.fields[name];
  const path = [...prefix, name];
  if (node.kind === 'has') {
    if (!isNull(node.condition)) checkValues(node.condition, targetScope(field, name, meta), path);
    return;
  }
  if (isUndefined(node.value)) return;
  for (const item of toArray(node.value)) {
    if (!matchesLogical(item, field)) throw invalidValueError(`where.${path.join('.')}`);
  }
}

/**
 * Whether a wire value matches a field's storage type: a UUID is a string, an integer a safe number.
 */
function matchesLogical(value: unknown, field: FieldQueryMeta): boolean {
  if (field.kind === 'record' || field.id === true) return isString(value);
  switch (field.logicalType) {
    case 'integer':
      return isNumber(value) && Number.isSafeInteger(value);
    case 'boolean':
      return isBoolean(value);
    case 'text':
      return isString(value);
    case 'json':
      return isString(value) || isNumber(value) || isBoolean(value);
    default:
      return true;
  }
}

/**
 * Parses `select` into the fields to read, rejecting an empty list, an over-long one, or an unknown field.
 */
function parseSelect(
  value: SearchParamValue | undefined,
  meta: CollectionQueryMeta,
  guards: QueryGuards,
): string[] | null {
  if (isUndefined(value)) return null;
  const fields = toStringList(value, 'select');
  if (fields.length === 0) throw emptySelectError();
  if (fields.length > guards.maxSelect)
    throw limitError('tooManyFields', 'select', guards.maxSelect);
  fields.forEach((field, index) => {
    if (isUndefined(meta.fields[field])) {
      throw invalidFieldError(
        field,
        `select[${index}]`,
        didYouMean(field, Object.keys(meta.fields)),
      );
    }
  });
  return fields;
}

/**
 * Parses `order` into sort keys, a leading `-` meaning descending, rejecting a duplicate or unsortable field.
 */
function parseOrder(
  value: SearchParamValue | undefined,
  meta: CollectionQueryMeta,
  guards: QueryGuards,
): OrderEntry[] {
  if (isUndefined(value)) return [];
  const entries = toStringList(value, 'order');
  if (entries.length > guards.maxOrder)
    throw limitError('tooManyOrderKeys', 'order', guards.maxOrder);
  const seen = new Set<string>();
  return entries.map((entry, index) => {
    const direction: OrderDirection = entry.startsWith('-') ? 'desc' : 'asc';
    const field = direction === 'desc' ? entry.slice(1) : entry;
    const fieldMeta = meta.fields[field];
    if (isUndefined(fieldMeta)) {
      throw invalidFieldError(
        field,
        `order[${index}]`,
        didYouMean(field, Object.keys(meta.fields)),
      );
    }
    if (isUndefined(fieldMeta.column)) throw invalidFieldError(field, `order[${index}]`, undefined);
    if (seen.has(field)) throw duplicateOrderFieldError(field, `order[${index}]`);
    seen.add(field);
    return { field, direction };
  });
}

/**
 * Parses `populate` into relation fields to hydrate, rejecting an unknown field or a non-relation one.
 */
function parsePopulate(value: SearchParamValue | undefined, meta: CollectionQueryMeta): string[] {
  if (isUndefined(value)) return [];
  const fields = toStringList(value, 'populate');
  fields.forEach((field, index) => {
    const fieldMeta = meta.fields[field];
    if (isUndefined(fieldMeta)) {
      throw invalidFieldError(
        field,
        `populate[${index}]`,
        didYouMean(field, Object.keys(meta.fields)),
      );
    }
    if (fieldMeta.kind !== 'record' && fieldMeta.kind !== 'records') {
      throw invalidFieldError(field, `populate[${index}]`, undefined);
    }
  });
  return fields;
}

/**
 * Parses the windowing params, rejecting a mix of the two modes and clamping `perPage` to its ceiling.
 */
function parseWindow(
  params: Record<string, SearchParamValue>,
  guards: QueryGuards,
): { limit: number | null; offset: number | null; page: number | null; perPage: number | null } {
  const limit = wholeNumber(params.limit, 'limit', 0);
  const offset = wholeNumber(params.offset, 'offset', 0);
  const page = wholeNumber(params.page, 'page', 1);
  const perPageRaw = wholeNumber(params.perPage, 'perPage', 1);
  if ((!isNull(limit) || !isNull(offset)) && (!isNull(page) || !isNull(perPageRaw)))
    throw paginationError();
  const perPage = isNull(perPageRaw) ? null : Math.min(perPageRaw, guards.maxPerPage);
  return { limit, offset, page, perPage };
}

/**
 * The bound parameters the row window compiles to, reserved from the aggregate bound-param ceiling.
 * `LIMIT ?` binds one, an `OFFSET` a second, and a paginated read binds its page size and offset.
 */
function windowBoundParams(window: {
  limit: number | null;
  offset: number | null;
  page: number | null;
  perPage: number | null;
}): number {
  if (!isNull(window.offset)) return 2;
  if (!isNull(window.limit)) return 1;
  if (!isNull(window.page) || !isNull(window.perPage)) return 2;
  return 0;
}

/**
 * Reads a param as a whole number at or above `min`, rejecting a non-integer, unsafe, or out-of-range value.
 */
function wholeNumber(
  value: SearchParamValue | undefined,
  param: string,
  min: number,
): number | null {
  if (isUndefined(value)) return null;
  if (!isNumber(value) || !Number.isSafeInteger(value) || value < min)
    throw invalidNumberError(param);
  return value;
}

/**
 * Normalizes a param to a list of strings, wrapping a lone string and rejecting a non-string element.
 */
function toStringList(value: SearchParamValue, param: string): string[] {
  const items = toArray(value);
  return items.map((item, index) => {
    if (!isString(item)) throw invalidFieldError(String(item), `${param}[${index}]`, undefined);
    return item;
  });
}
