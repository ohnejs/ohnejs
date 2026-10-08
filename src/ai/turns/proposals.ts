import type {
  CollectionQueryMeta,
  ConditionInput,
  ParsedQuery,
  PopulateSpec,
  QueryScope,
  WireErrorData,
} from 'ohnejs';
import type { SearchParamValue } from 'ohnejs/utils';

import {
  HTTPError,
  parseLocaleParam,
  parseWireQuery,
  queryMetadata,
  resolveGuards,
  scopedMetadata,
} from 'ohnejs';
import {
  fillRoute,
  hasKey,
  isArray,
  isEmpty,
  isNull,
  isPlainObject,
  isInteger,
  isString,
  isUndefined,
  isUUID,
  uniqueArray,
} from 'ohnejs/utils';

import type { AITier } from '../config.ts';
import type { Receipt } from './receipts.ts';
import type { OfferedRoute, ReachableCollection, Surface } from './surface.ts';

import { readScope } from '../../base/collections-api/gate.ts';
import { SEARCH_MAX_LIMIT, SEARCH_MAX_OFFSET } from '../../base/collections-api/search.ts';
import { invalidFieldError } from '../../ohne/query/wire/errors.ts';
import { useAIConfig } from '../config.ts';
import { identityOnly, refusal } from './receipts.ts';

/**
 * One request the model proposes, as the browser receives it.
 */
export interface Proposal {
  /**
   * The route id, as the surface lists it.
   */
  route: string;

  /**
   * The route's tier, which decides whether the browser asks before sending.
   */
  tier: AITier;

  /**
   * The route's params, each checked; a `uuid` is a `UUID`.
   */
  params?: Record<string, string>;

  /**
   * The URL params, each a key the route takes.
   */
  query?: Record<string, SearchParamValue>;

  /**
   * The JSON body, checked against what the route takes.
   */
  body?: Record<string, unknown>;

  /**
   * The filter of a write by set, in place of `params`; the browser expands it into one request per record.
   */
  where?: ConditionInput;

  /**
   * A rewrite of an update's text fields by a model, in place of `body`.
   * The browser runs it through `POST /ai/turns/[id]/transform` and sends each approved record as an update.
   */
  transform?: Transform;

  /**
   * Set on a write the browser sends without asking, since the person's auto-accept covers it.
   * Only the server sets it, after the check, from the person's account setting and `ai.autoAccept`.
   */
  auto?: true;
}

/**
 * A rewrite of an update's text fields, proposed in place of a body.
 */
export interface Transform {
  /**
   * The fields to rewrite, each one the surface lists as rewritable for the collection.
   */
  fields: string[];

  /**
   * What to do with each value, as the model wrote it.
   */
  instruction: string;
}

/**
 * A proposal the server accepted, with what shaping its receipt needs.
 */
export interface Accepted {
  /**
   * The offered route the proposal names.
   */
  route: OfferedRoute;

  /**
   * The proposal, normalized.
   */
  proposal: Proposal;

  /**
   * Whether the proposal's filter passed the identity rule, so its receipt may list ids.
   */
  identity: boolean;
}

/**
 * The outcome of checking one proposal: accepted, or refused with the receipt the model reads.
 */
export type Checked = { ok: true; accepted: Accepted } | { ok: false; receipt: Receipt };

type Attempt<T> = { ok: true; value: T } | { ok: false; code: string; path: string };

/**
 * The keys a proposal may carry, as the `request` tool offers them.
 * `auto` is left out: the model never tags its own proposal.
 */
export const PROPOSAL_KEYS: ReadonlySet<string> = new Set([
  'route',
  'params',
  'query',
  'body',
  'where',
  'transform',
]);

/**
 * The keys a proposal's `transform` may carry.
 */
export const TRANSFORM_KEYS: ReadonlySet<string> = new Set(['fields', 'instruction']);

/**
 * The keys a `POST /search` body may carry.
 */
const SEARCH_KEYS = new Set(['q', 'collection', 'via', 'limit', 'offset']);
const VERDICT_KEYS = new Set(['where', 'UUIDs', 'locale']);
const WINDOW_KEYS = ['limit', 'offset', 'page', 'perPage'];

/**
 * The longest instruction a transform may carry.
 */
const MAX_INSTRUCTION = 4_000;

/**
 * Checks one proposal against the surface, refusing anything the person's browser must never send.
 *
 * The route must be offered; its params must be complete, and a `uuid` a `UUID`.
 * The query may carry only the keys the route takes, and a `locale` must be configured.
 * A wire query in the body or the query parses as the person's read would.
 * Its reach answers `false` for every denied collection, so a `has` or `populate` into one fails.
 * A locale-tagged update may carry translatable fields alone; a create writes the others as well.
 * A write by set needs a route with a `uuid` param above the read tier, and its filter parses the same way.
 * A transform stands in for an update's body and names rewritable fields alone, translatable at a locale.
 * A list read without a window gets `page: 1`, so its receipt carries a total.
 * A `select` without `UUID` gains it, so every answered record names itself.
 * A refusal is a `400` receipt, its code and path as the API would answer them.
 */
export async function checkProposal(input: unknown, surface: Surface): Promise<Checked> {
  if (!isPlainObject(input)) return refuse('', 'invalidShape');
  const id = isString(input.route) ? input.route : '';
  for (const key of Object.keys(input)) {
    if (!PROPOSAL_KEYS.has(key)) return refuse(id, 'unknownParam', key);
  }
  const route = surface.routes.get(id);
  if (isUndefined(route)) return refuse(id, 'unknownRoute', 'route');
  const reachable = isUndefined(route.collection)
    ? undefined
    : surface.collections.get(route.collection);
  const proposal: Proposal = { route: id, tier: route.tier };

  const params = checkParams(input.params, input.where, route);
  if (!params.ok) return refuse(id, params.code, params.path);
  if (!isUndefined(params.value)) proposal.params = params.value;

  const query = await checkQuery(input.query, route, reachable);
  if (!query.ok) return refuse(id, query.code, query.path);
  if (!isUndefined(query.value)) proposal.query = query.value;

  let identity = false;
  if (!isUndefined(input.transform)) {
    if (!isUndefined(input.body)) return refuse(id, 'invalidShape', 'body');
    const transform = checkTransform(input.transform, route, reachable, proposal.query?.locale);
    if (!transform.ok) return refuse(id, transform.code, transform.path);
    proposal.transform = transform.value;
  } else {
    const body = await checkBody(input.body, route, surface, proposal.query?.locale);
    if (!body.ok) return refuse(id, body.code, body.path);
    if (!isUndefined(body.value.body)) proposal.body = body.value.body;
    identity = body.value.identity;
  }
  if (!isUndefined(input.where)) {
    const set = await checkSet(input.where, reachable, proposal.query?.locale);
    if (!set.ok) return refuse(id, set.code, set.path);
    proposal.where = set.value;
    identity = false;
  }
  return { ok: true, accepted: { route, proposal, identity } };
}

/**
 * A refused proposal, as a `400` receipt.
 */
function refuse(route: string, code: string, path?: string): Checked {
  return { ok: false, receipt: refusal(route, code, path) };
}

/**
 * Checks the params: every one the pattern names, each fit for its segment, a `uuid` a `UUID`.
 * A write by set names none, and needs a `uuid` route above the read tier.
 */
function checkParams(
  params: unknown,
  where: unknown,
  route: OfferedRoute,
): Attempt<Record<string, string> | undefined> {
  if (!isUndefined(where)) {
    if (!isUndefined(params)) return failed('invalidShape', 'params');
    if (!route.params.includes('uuid') || route.tier === 'read') {
      return failed('invalidShape', 'where');
    }
    return { ok: true, value: undefined };
  }
  const given = params ?? {};
  if (!isPlainObject(given)) return failed('invalidShape', 'params');
  for (const key of Object.keys(given)) {
    if (!route.params.includes(key)) return failed('unknownParam', `params.${key}`);
  }
  const filled: Record<string, string> = {};
  for (const name of route.params) {
    const value = given[name];
    if (!isString(value) || (name === 'uuid' && !isUUID(value))) {
      return failed('invalidValue', `params.${name}`);
    }
    filled[name] = value;
  }
  try {
    fillRoute(route.pattern, { ...filled, collection: 'x' });
  } catch {
    return failed('invalidValue', 'params');
  }
  return { ok: true, value: route.params.length === 0 ? undefined : filled };
}

/**
 * Checks the query: only the keys the route takes, parsed as its read or write would parse them.
 */
async function checkQuery(
  query: unknown,
  route: OfferedRoute,
  reachable: ReachableCollection | undefined,
): Promise<Attempt<Record<string, SearchParamValue> | undefined>> {
  if (isUndefined(query)) return { ok: true, value: undefined };
  if (!isPlainObject(query)) return failed('invalidShape', 'query');
  for (const key of Object.keys(query)) {
    if (!route.query.includes(key)) return failed('unknownParam', `query.${key}`);
  }
  const params = query as Record<string, SearchParamValue>;
  if (isUndefined(reachable)) return { ok: true, value: params };
  const parsed = route.query.includes('select')
    ? await attempt(() => parseQuery(params, reachable), 'query')
    : await attempt(() => parseLocaleParam(params.locale, reachable.meta), 'query');
  if (!parsed.ok) return parsed;
  return { ok: true, value: withUUID(params) };
}

/**
 * Checks a `POST /search` body: `q` as text, with an optional `collection`, `via`, `limit` and `offset`.
 * A `via` stands only beside `collection`, and neither may name a collection `ai.deny` lists.
 * A `limit` outside 1 to `SEARCH_MAX_LIMIT`, or an `offset` outside 0 to `SEARCH_MAX_OFFSET`, is refused.
 * The route would answer either short, and the model would read the short count as the whole.
 * The body it returns names `ai.deny`'s collections in `exclude`, so they never take a related pass.
 */
function checkSearch(
  body: Record<string, unknown>,
): Attempt<{ body: Record<string, unknown>; identity: boolean }> {
  for (const key of Object.keys(body)) {
    if (!SEARCH_KEYS.has(key)) return failed('unknownParam', `body.${key}`);
  }
  if (!isString(body.q)) return failed('invalidValue', 'body.q');
  const { deny } = useAIConfig();
  const named = (value: unknown) => isString(value) && !deny.collections.includes(value);
  if (!isUndefined(body.collection) && !named(body.collection)) {
    return failed('invalidValue', 'body.collection');
  }
  if (!isUndefined(body.via) && (!named(body.via) || isUndefined(body.collection))) {
    return failed('invalidValue', 'body.via');
  }
  const windows = { limit: [1, SEARCH_MAX_LIMIT], offset: [0, SEARCH_MAX_OFFSET] } as const;
  for (const [key, [min, max]] of Object.entries(windows)) {
    const value = body[key];
    if (!isUndefined(value) && !(isInteger(value) && value >= min && value <= max)) {
      return failed('invalidValue', `body.${key}`);
    }
  }
  return { ok: true, value: { body: { ...body, exclude: deny.collections }, identity: false } };
}

/**
 * Checks the body by what the route takes, and whether a list read's filter passed the identity rule.
 */
async function checkBody(
  body: unknown,
  route: OfferedRoute,
  { collections }: Surface,
  locale: SearchParamValue | undefined,
): Promise<Attempt<{ body?: Record<string, unknown>; identity: boolean }>> {
  const given = isUndefined(body) || isPlainObject(body) ? body : null;
  if (isNull(given)) return failed('invalidShape', 'body');
  if (route.body === 'none') {
    return isUndefined(given)
      ? { ok: true, value: { identity: false } }
      : failed('unknownParam', 'body');
  }
  if (route.body === 'app') return { ok: true, value: { body: given, identity: false } };
  if (route.body === 'search') return checkSearch(given ?? {});
  const collection = collections.get(route.collection as string) as ReachableCollection;
  if (route.body === 'query') {
    const parsed = await attempt(
      () => parseQuery((given ?? {}) as Record<string, SearchParamValue>, collection),
      'body',
    );
    if (!parsed.ok) return parsed;
    const windowed = WINDOW_KEYS.some((key) => hasKey(given ?? {}, key));
    return {
      ok: true,
      value: {
        body: withUUID({ ...given, ...(windowed ? {} : { page: 1 }) }),
        identity: identityOnly(parsed.value, collection.meta.collection, collections),
      },
    };
  }
  if (route.body === 'verdicts') return checkVerdicts(given ?? {}, collection, collections);
  if (route.body === 'copy') {
    for (const key of Object.keys(given ?? {})) {
      if (key !== 'source') return failed('unknownParam', `body.${key}`);
    }
    const source = await attempt(
      () => parseLocaleParam(given?.source as SearchParamValue, collection.meta, 'source'),
      'body',
    );
    if (!source.ok) return source;
    return { ok: true, value: { body: given, identity: false } };
  }
  if (isUndefined(given)) return failed('invalidShape', 'body');
  if (route.method === 'PATCH' && !isUndefined(locale)) {
    for (const key of Object.keys(given)) {
      const field = collection.meta.fields[key];
      if (field?.companion !== true && field?.localeScoped !== true) {
        return failed('invalidField', `body.${key}`);
      }
    }
  }
  return { ok: true, value: { body: given, identity: false } };
}

/**
 * Checks a transform: an update route, a non-empty instruction, and fields the collection may rewrite.
 * At a locale, every field must be translatable, as the update it becomes takes translatable fields alone.
 */
function checkTransform(
  input: unknown,
  route: OfferedRoute,
  reachable: ReachableCollection | undefined,
  locale: SearchParamValue | undefined,
): Attempt<Transform> {
  if (route.method !== 'PATCH' || route.body !== 'record' || isUndefined(reachable)) {
    return failed('invalidShape', 'transform');
  }
  if (!isPlainObject(input)) return failed('invalidShape', 'transform');
  for (const key of Object.keys(input)) {
    if (!TRANSFORM_KEYS.has(key)) return failed('unknownParam', `transform.${key}`);
  }
  const { fields, instruction } = input;
  if (!isString(instruction) || instruction.trim() === '' || instruction.length > MAX_INSTRUCTION) {
    return failed('invalidValue', 'transform.instruction');
  }
  if (
    !isArray(fields) ||
    isEmpty(fields) ||
    !fields.every(isString) ||
    uniqueArray(fields).length !== fields.length
  ) {
    return failed('invalidValue', 'transform.fields');
  }
  for (const [index, name] of fields.entries()) {
    const translatable = reachable.meta.fields[name]?.companion === true;
    if (!reachable.rewritable.includes(name) || (!isUndefined(locale) && !translatable)) {
      return failed('invalidField', `transform.fields[${index}]`);
    }
  }
  return { ok: true, value: { fields: [...fields], instruction } };
}

/**
 * Checks a verdicts body: named rows, each a `UUID`, or a filter parsed as the list read parses it.
 */
async function checkVerdicts(
  body: Record<string, unknown>,
  collection: ReachableCollection,
  collections: Surface['collections'],
): Promise<Attempt<{ body?: Record<string, unknown>; identity: boolean }>> {
  for (const key of Object.keys(body)) {
    if (!VERDICT_KEYS.has(key)) return failed('unknownParam', `body.${key}`);
  }
  if (!isUndefined(body.UUIDs)) {
    if (!isUndefined(body.where)) return failed('invalidValue', 'body.where');
    if (!isArray(body.UUIDs) || !body.UUIDs.every(isUUID)) {
      return failed('invalidValue', 'body.UUIDs');
    }
    const locale = await attempt(
      () => parseLocaleParam(body.locale as SearchParamValue, collection.meta),
      'body',
    );
    if (!locale.ok) return locale;
    return { ok: true, value: { body, identity: true } };
  }
  const parsed = await attempt(
    () => parseQuery(body as Record<string, SearchParamValue>, collection),
    'body',
  );
  if (!parsed.ok) return parsed;
  return {
    ok: true,
    value: { body, identity: identityOnly(parsed.value, collection.meta.collection, collections) },
  };
}

/**
 * Checks a write by set: its filter parses as the collection's list read would.
 */
async function checkSet(
  where: unknown,
  reachable: ReachableCollection | undefined,
  locale: SearchParamValue | undefined,
): Promise<Attempt<ConditionInput>> {
  if (isUndefined(reachable) || !isPlainObject(where)) return failed('invalidShape', 'where');
  const params = { where, ...(isUndefined(locale) ? {} : { locale }) } as Record<
    string,
    SearchParamValue
  >;
  const parsed = await attempt(() => parseQuery(params, reachable), '');
  if (!parsed.ok) return parsed;
  return { ok: true, value: where as ConditionInput };
}

/**
 * The params with `UUID` added to a `select` that leaves it out, so every answered record names itself.
 */
function withUUID<T extends Record<string, unknown>>(params: T): T {
  const { select } = params;
  if (!isArray(select) || select.includes('UUID')) return params;
  return { ...params, select: ['UUID', ...select] };
}

/**
 * Parses a wire query as the person's list read of the collection would, denied collections unreachable.
 * A populate into a denied collection is refused as an unknown field, as a `has` into one is.
 */
async function parseQuery(
  params: Record<string, SearchParamValue>,
  { meta, scope }: ReachableCollection,
): Promise<ParsedQuery> {
  const denied = new Set(useAIConfig().deny.collections);
  const reach = (collection: string): Promise<QueryScope | false> =>
    denied.has(collection) ? Promise.resolve(false) : readScope(collection);
  const scoped = scopedMetadata(meta, scope === false ? { select: [] } : scope);
  const parsed = await parseWireQuery(params, scoped, resolveGuards(), reach);
  const hidden = deniedPopulate(parsed.populate, meta, denied, 'populate');
  if (!isUndefined(hidden)) throw invalidFieldError(hidden.field, hidden.path, undefined);
  return parsed;
}

/**
 * The first populate entry that crosses into a denied collection, with its path, or `undefined`.
 */
function deniedPopulate(
  entries: readonly (string | PopulateSpec)[],
  meta: CollectionQueryMeta,
  denied: ReadonlySet<string>,
  path: string,
): { field: string; path: string } | undefined {
  for (const [index, entry] of entries.entries()) {
    const specs = isString(entry) ? { [entry]: {} } : entry;
    for (const [field, spec] of Object.entries(specs)) {
      const target = meta.fields[field]?.target;
      if (isUndefined(target)) continue;
      const at = isString(entry) ? `${path}[${index}]` : `${path}[${index}].${field}`;
      if (denied.has(target)) return { field, path: at };
      const nested = spec.populate ?? [];
      const inner = deniedPopulate(nested, queryMetadata(target), denied, `${at}.populate`);
      if (!isUndefined(inner)) return inner;
    }
  }
  return undefined;
}

/**
 * Runs a wire parse, turning the `400` it throws into a failed attempt at `prefix` plus its path.
 * Any other throw propagates.
 */
async function attempt<T>(run: () => T | Promise<T>, prefix: string): Promise<Attempt<T>> {
  try {
    return { ok: true, value: await run() };
  } catch (error) {
    if (!(error instanceof HTTPError) || error.status !== 400) throw error;
    const data = error.data as Partial<WireErrorData> | undefined;
    const path = data?.path ?? '';
    return failed(
      data?.code ?? 'invalidShape',
      [prefix, path].filter((part) => part !== '').join('.'),
    );
  }
}

/**
 * A failed attempt.
 */
function failed(code: string, path: string): { ok: false; code: string; path: string } {
  return { ok: false, code, path };
}
