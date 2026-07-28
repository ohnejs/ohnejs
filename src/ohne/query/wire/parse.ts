import type { ConditionNode, SearchParamValue } from '../../../utils/index.ts';
import type { HTTPError } from '../../http/http-error.ts';
import type { OrderDirection, OrderEntry } from '../ir.ts';
import type { CollectionQueryMeta, FieldQueryMeta } from '../metadata.ts';
import type { ConditionInput, PopulateSpec, PopulateSubQuery } from '../untyped.ts';
import type { QueryGuards } from './guards.ts';

import {
  canonicalizeLanguage,
  didYouMean,
  isArray,
  isBoolean,
  isInteger,
  isNull,
  isNumber,
  isPlainObject,
  isRealNumber,
  isString,
  isUndefined,
  parseCondition,
  toArray,
  walkCondition,
} from '../../../utils/index.ts';
import { splitBlockHas } from '../block-has.ts';
import { queryLocales } from '../locale.ts';
import { queryMetadata } from '../metadata.ts';
import {
  blockScope,
  checkCondition,
  targetScope,
  type ConditionProblem,
} from '../validate-condition.ts';
import {
  blockTypeRequiredError,
  conditionShapeError,
  duplicateOrderFieldError,
  duplicatePopulateFieldError,
  emptySelectError,
  invalidFieldError,
  invalidLocaleError,
  invalidNumberError,
  invalidSpecError,
  invalidValueError,
  limitError,
  localeNotApplicableError,
  paginationError,
  unknownBlockTypeError,
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
   * The relations to hydrate - bare names or recursive spec objects; empty when the query names none.
   * Spec values arrive normalized: a lone-string `select` or `populate` is already a proper list.
   *
   * @example
   * ```ts
   * ['author', { comments: { select: ['text'], populate: ['author'] } }]
   * ```
   */
  populate: (string | PopulateSpec)[];

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

  /**
   * The validated content locale the query reads, or `null` for the default.
   */
  locale: string | null;
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
  'locale',
]);

/**
 * Parses and validates URL (or JSON-body) query parameters against a collection's metadata.
 *
 * Every failure throws an `HTTPError(400)` carrying a stable `code` and the offending dot `path`.
 * The condition parses through the shared grammar, then gates applicability, DoS ceilings, and value types.
 * `select`, `order`, and `populate` gate against the same fields; the two windowing modes are exclusive.
 * `locale` canonicalizes and must name a configured content locale on a translatable collection.
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
    populate: parsePopulate(params.populate, meta, guards),
    ...window,
    locale: parseLocaleParam(params.locale, meta),
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
  const problem = checkCondition(parsed.node, meta, [], true);
  if (!isNull(problem)) throw problemError(problem);
  enforceGuards(parsed.node, guards, reserved);
  checkValues(parsed.node, meta, []);
  return value as ConditionInput;
}

/**
 * Maps an applicability failure onto its wire error at its `where` dot path.
 * The field kinds collapse to `invalidField`; the blocks kinds keep their own codes.
 * The field already proved itself a blocks field, so there is no existence oracle to protect.
 */
function problemError(problem: ConditionProblem): HTTPError {
  const path = `where.${problem.path.join('.')}`;
  if (problem.kind === 'blockTypeRequired') return blockTypeRequiredError(problem.field, path);
  if (problem.kind === 'unknownBlockType') {
    return unknownBlockTypeError(problem.block as string, path, problem.suggestion);
  }
  return invalidFieldError(problem.field, path, problem.suggestion);
}

/**
 * Enforces the DoS ceilings over a condition: clause count, `has` nesting, list length, and value size.
 * None of these depend on the field scope, so one flat walk covers the whole tree.
 * The bound-param ceiling is aggregate; the per-key ceilings never sum toward it.
 * It counts the worst-case locale binds too: one for the companion join, two per `has`/`empty`.
 * A translatable shape thus refuses here rather than dying at the driver's own wall.
 * A fan of legal `in` lists is caught here, against a ceiling `resolveGuards` already clamped under the wall.
 */
function enforceGuards(node: ConditionNode, guards: QueryGuards, reserved: number): void {
  let conditions = 0;
  let boundParams = reserved + 1;
  walkCondition(node, (child, info) => {
    if (child.kind === 'compare' || child.kind === 'has' || child.kind === 'empty') {
      conditions += 1;
      if (conditions > guards.maxConditions) {
        throw limitError('tooManyConditions', 'where', guards.maxConditions);
      }
    }
    if (info.hasDepth > guards.maxHasDepth)
      throw limitError('hasTooDeep', 'where', guards.maxHasDepth);
    if (child.kind === 'has' || child.kind === 'empty') {
      boundParams += 2;
      if (boundParams > guards.maxBoundParams) {
        throw limitError('tooManyBoundParams', 'where', guards.maxBoundParams);
      }
      return;
    }
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
 * A blocks `has` walks only the remainder past its discriminator.
 * The discriminator leaf is the already-validated type name, not a column.
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
    if (isNull(node.condition)) return;
    if (field.kind === 'blocks') {
      const split = splitBlockHas(node.condition);
      if (split.ok && !isNull(split.rest)) {
        checkValues(split.rest, blockScope(split.block, name, meta), path);
      }
      return;
    }
    checkValues(node.condition, targetScope(field, name, meta), path);
    return;
  }
  if (isUndefined(node.value)) return;
  for (const item of toArray(node.value)) {
    if (!matchesLogical(item, field)) throw invalidValueError(`where.${path.join('.')}`);
  }
}

/**
 * Whether a wire value matches a field's storage type.
 * A UUID is a string, an integer a safe number, a real a finite one.
 */
function matchesLogical(value: unknown, field: FieldQueryMeta): boolean {
  if (field.kind === 'record' || field.id === true) return isString(value);
  switch (field.logicalType) {
    case 'integer':
      return isInteger(value);
    case 'real':
      return isRealNumber(value);
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
 * A `readable: false` field rejects exactly as an unknown one - the wire keeps no existence oracle.
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
    if (isUndefined(meta.fields[field]) || meta.fields[field].readable === false) {
      throw invalidFieldError(field, `select[${index}]`, didYouMean(field, readableNames(meta)));
    }
  });
  return fields;
}

/**
 * The field names the wire may address: everything a read can return.
 * A `readable: false` name stays out, so a `didYouMean` hint can never reveal one.
 */
function readableNames(meta: CollectionQueryMeta): string[] {
  return Object.keys(meta.fields).filter((name) => meta.fields[name]?.readable !== false);
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
    if (isUndefined(fieldMeta) || fieldMeta.readable === false) {
      throw invalidFieldError(field, `order[${index}]`, didYouMean(field, readableNames(meta)));
    }
    if (isUndefined(fieldMeta.column)) throw invalidFieldError(field, `order[${index}]`, undefined);
    if (seen.has(field)) throw duplicateOrderFieldError(field, `order[${index}]`);
    seen.add(field);
    return { field, direction };
  });
}

/**
 * Parses `populate` into validated entries: bare relation names, or spec objects narrowing per relation.
 *
 * A spec object's keys are relations of its level's collection.
 * A spec carries `select` and `populate` alone, recursing the same grammar one level down.
 * Depth counts populate levels from `1` at the root and gates against `maxPopulateDepth`.
 * The total node count gates against `maxPopulate`.
 * A field repeated at one level passes for two bare names and fails otherwise.
 * The entries return normalized: a lone-string `select` or `populate` value becomes a proper list.
 */
function parsePopulate(
  value: SearchParamValue | undefined,
  meta: CollectionQueryMeta,
  guards: QueryGuards,
): (string | PopulateSpec)[] {
  if (isUndefined(value)) return [];
  return parsePopulateLevel(toArray(value), meta, 'populate', 1, guards, { nodes: 0 });
}

/**
 * Validates one level of populate entries against its collection, counting depth and nodes.
 * An unknown or non-relation name collapses to `invalidField`, whatever form carried it.
 * Returns the level rebuilt in normalized form, so the parsed shape matches its declared type.
 */
function parsePopulateLevel(
  entries: readonly unknown[],
  meta: CollectionQueryMeta,
  path: string,
  depth: number,
  guards: QueryGuards,
  budget: { nodes: number },
): (string | PopulateSpec)[] {
  if (depth > guards.maxPopulateDepth) {
    throw limitError('populateTooDeep', path, guards.maxPopulateDepth);
  }
  const bare = new Map<string, boolean>();
  return entries.map((entry, index) => {
    if (isString(entry)) {
      countPopulateNode(budget, guards);
      populatedRelation(entry, `${path}[${index}]`, meta);
      registerPopulateField(bare, entry, true, `${path}[${index}]`);
      return entry;
    }
    if (!isPlainObject(entry)) {
      throw invalidFieldError(String(entry), `${path}[${index}]`, undefined);
    }
    const normalized: PopulateSpec = {};
    for (const [field, spec] of Object.entries(entry)) {
      countPopulateNode(budget, guards);
      const specPath = `${path}[${index}].${field}`;
      const fieldMeta = populatedRelation(field, specPath, meta);
      registerPopulateField(bare, field, false, specPath);
      normalized[field] = parsePopulateSpec(spec, fieldMeta, specPath, depth, guards, budget);
    }
    return normalized;
  });
}

/**
 * Validates one spec: `select`/`populate` keys alone, the subselect against the target, then descent.
 * An empty subselect is `emptySelect` at its own path, mirroring the top-level rule.
 * Returns the spec normalized, its `select` and `populate` values proper lists.
 */
function parsePopulateSpec(
  spec: unknown,
  fieldMeta: FieldQueryMeta,
  path: string,
  depth: number,
  guards: QueryGuards,
  budget: { nodes: number },
): PopulateSubQuery {
  if (!isPlainObject(spec)) throw invalidSpecError(path);
  for (const key of Object.keys(spec)) {
    if (key !== 'select' && key !== 'populate') throw invalidSpecError(path);
  }
  const target = queryMetadata(fieldMeta.target as string);
  const normalized: PopulateSubQuery = {};
  if (!isUndefined(spec.select)) {
    const fields = toStringList(spec.select as SearchParamValue, `${path}.select`);
    if (fields.length === 0) throw emptySelectError(`${path}.select`);
    if (fields.length > guards.maxSelect) {
      throw limitError('tooManyFields', `${path}.select`, guards.maxSelect);
    }
    fields.forEach((name, index) => {
      if (isUndefined(target.fields[name]) || target.fields[name].readable === false) {
        throw invalidFieldError(
          name,
          `${path}.select[${index}]`,
          didYouMean(name, readableNames(target)),
        );
      }
    });
    normalized.select = fields;
  }
  if (!isUndefined(spec.populate)) {
    normalized.populate = parsePopulateLevel(
      toArray(spec.populate),
      target,
      `${path}.populate`,
      depth + 1,
      guards,
      budget,
    );
  }
  return normalized;
}

/**
 * Resolves a populated name to its relation metadata, collapsing every failure to `invalidField`.
 * A `readable: false` relation collapses too, exactly as a name that does not exist.
 */
function populatedRelation(field: string, path: string, meta: CollectionQueryMeta): FieldQueryMeta {
  const fieldMeta = meta.fields[field];
  if (isUndefined(fieldMeta) || fieldMeta.readable === false) {
    throw invalidFieldError(field, path, didYouMean(field, readableNames(meta)));
  }
  if (fieldMeta.kind !== 'record' && fieldMeta.kind !== 'records') {
    throw invalidFieldError(field, path, undefined);
  }
  return fieldMeta;
}

/**
 * Tracks the fields one level populates: bare repeats pass, any repeat involving a spec throws.
 */
function registerPopulateField(
  bare: Map<string, boolean>,
  field: string,
  isBare: boolean,
  path: string,
): void {
  const existing = bare.get(field);
  if (isUndefined(existing)) {
    bare.set(field, isBare);
    return;
  }
  if (existing && isBare) return;
  throw duplicatePopulateFieldError(field, path);
}

/**
 * Counts one populate node toward the tree total, refusing past `maxPopulate`.
 */
function countPopulateNode(budget: { nodes: number }, guards: QueryGuards): void {
  budget.nodes += 1;
  if (budget.nodes > guards.maxPopulate) {
    throw limitError('tooManyPopulate', 'populate', guards.maxPopulate);
  }
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
 * Parses a `locale` param into the canonical content locale a translatable collection addresses.
 * A locale on a non-translatable collection, a malformed tag, or one outside the configured set throws.
 * `parseQueryParams` runs it for reads; a write endpoint runs it alone, since writes take no query.
 */
export function parseLocaleParam(
  value: SearchParamValue | undefined,
  meta: CollectionQueryMeta,
): string | null {
  if (isUndefined(value)) return null;
  if (meta.translatable !== true) throw localeNotApplicableError();
  if (!isString(value)) throw invalidLocaleError(String(value));
  const canonical = canonicalizeLanguage(value);
  if (isNull(canonical) || !queryLocales().locales.includes(canonical)) {
    throw invalidLocaleError(value);
  }
  return canonical;
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
  if (!isInteger(value) || value < min) throw invalidNumberError(param);
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
