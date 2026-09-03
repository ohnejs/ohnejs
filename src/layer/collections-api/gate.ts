import type {
  AccessContext,
  CollectionEndpoint,
  CollectionMeta,
  CollectionOperation,
  CollectionQueryMeta,
  MiddlewareKey,
  ParsedQuery,
  QueryScope,
} from 'ohne';
import type { Defined, SearchParamValue } from 'ohne/utils';

import {
  applyQuery,
  endpointOf,
  parseLocaleParam,
  parseQueryParams,
  queryMetadata,
  queryUntyped,
  readRecordBody,
  resolveAccess,
  resolveGuards,
  useCollections,
  useEvent,
  useMiddleware,
  useSearchParams,
} from 'ohne';
import {
  chunk,
  isArray,
  isEmpty,
  isNull,
  isString,
  isUndefined,
  parseCondition,
  pick,
  toKebabCase,
  walkCondition,
} from 'ohne/utils';

import { ohneError } from '../../ohne/error/ohne-error.ts';
import { notFound } from '../../ohne/http/http-error.ts';
import { queryLocales } from '../../ohne/query/locale.ts';
import { unknownParamError } from '../../ohne/query/wire/errors.ts';
import { requireCapability } from '../auth/capabilities.ts';

/**
 * An admitted request carries the collection and the operation's endpoint.
 * A refused one carries the middleware's answer.
 */
export type CollectionAdmission<O extends CollectionOperation = CollectionOperation> =
  | { ok: true; collection: string; endpoint: CollectionEndpoint<string, O> }
  | { ok: false; response: unknown };

/**
 * A passed gate carries the resolved collection name and access scope; a failed one the middleware's answer.
 */
export type CollectionGate =
  | { ok: true; collection: string; scope: QueryScope }
  | { ok: false; response: unknown };

/**
 * The page size a paginated list read takes when the request names `page` without `perPage`.
 */
export const LIST_PER_PAGE = 20;

/**
 * Admits a request into one operation of the collection a route segment names.
 *
 * The segment is the collection's kebab-case name.
 * An unknown collection, an unexposed one, and a closed operation all answer the identical `404`.
 * The API therefore reveals nothing about what exists.
 * Unless the operation is `public`, the guard then runs.
 * It needs a signed-in user holding `collection.<Name>.<operation>`: no user `401`, no capability `403`.
 * The operation's named middleware then run in order, exactly as route middleware do.
 * Each records on the event; a returned value answers the request without the operation running.
 * An unknown middleware name throws - a misconfigured exposure is a `500`, never an open door.
 */
export async function admitCollection<O extends CollectionOperation>(
  segment: string,
  operation: O,
): Promise<CollectionAdmission<O>> {
  const meta = collectionBySegment(segment);
  const endpoint = isUndefined(meta) ? undefined : endpointOf(meta.collection.api, operation);
  if (isUndefined(meta) || isUndefined(endpoint)) throw notFound();
  if (endpoint.public !== true) {
    await requireCapability(`collection.${meta.name}.${operation}`);
  }
  const event = useEvent();
  for (const name of endpoint.middleware ?? []) {
    const middleware = useMiddleware().get(name);
    if (isUndefined(middleware)) {
      throw ohneError(
        `Collection \`${meta.name}\` names unknown middleware \`${name}\` in its \`api\` exposure`,
      );
    }
    event.appliedMiddleware.push(name as MiddlewareKey);
    const result = await middleware(event);
    if (!isUndefined(result)) return { ok: false, response: result };
  }
  return { ok: true, collection: meta.name, endpoint };
}

/**
 * Admits a request into a read or delete and resolves its `access` scope in one step.
 * Neither operation carries a write input, so the resolver's context names the operation alone.
 * A create or update admits, reads its body, and resolves the scope itself, so the resolver judges the input.
 * `false` answers the identical `404`; the scope rides the gate for the handler to compose.
 */
export async function gateCollection(
  segment: string,
  operation: 'read' | 'delete',
): Promise<CollectionGate> {
  const admitted = await admitCollection(segment, operation);
  if (!admitted.ok) return admitted;
  const scope = await accessScope(admitted.endpoint, { operation });
  return { ok: true, collection: admitted.collection, scope };
}

/**
 * Reads a write's JSON body for its `access` resolver, deferring a failure until the verdict is known.
 * A refused caller answers the identical `404` whatever they sent, so a bad body resolves as an empty write.
 * The `failure`, when set, is the body's own error for the handler to throw once the verdict admits.
 */
export async function readWriteBody(): Promise<{
  input: Record<string, unknown>;
  failure: unknown;
}> {
  try {
    return { input: await readRecordBody(), failure: undefined };
  } catch (failure) {
    return { input: {}, failure };
  }
}

/**
 * Resolves an endpoint's `access` for one context, answering a refusal as the identical `404`.
 * A misconfigured scope throws, so it is a `500`, never an open door.
 */
export async function accessScope<O extends CollectionOperation>(
  endpoint: CollectionEndpoint<string, O>,
  context: AccessContext<O>,
): Promise<QueryScope> {
  const scope = await resolveAccess(endpoint, context);
  if (scope === false) throw notFound();
  return scope;
}

/**
 * Pins a list read's terminal: `paginate` when the request names a page, `findMany` otherwise.
 * Shared by the `GET` list and the `POST` body-query endpoint, so both transports read identically.
 * The gate's access scope composes in, narrowing the rows and fields the request may reach.
 * Each answered record's `_translations` then narrows to the locales the scope admits it at.
 */
export async function listRecords(
  collection: string,
  parsed: ParsedQuery,
  scope: QueryScope,
): Promise<unknown> {
  const meta = queryMetadata(collection);
  const builder = applyQuery(queryUntyped(collection), parsed, scope);
  if (isNull(parsed.page) && isNull(parsed.perPage)) {
    const records = await builder.findMany();
    await scopeTranslations(records, collection, meta, scope);
    return records;
  }
  const page = await builder.paginate(parsed.page ?? 1, parsed.perPage ?? LIST_PER_PAGE);
  await scopeTranslations(page.records, collection, meta, scope);
  return page;
}

/**
 * Narrows each record's `_translations` to the locales the scope `where` admits it at.
 *
 * A scope `where` over translatable fields reads per locale, so a record it admits at `en` may hide at `de`.
 * That locale never lists, exactly as the translations endpoint promises.
 * Only a locale-sensitive `where` on a translatable collection probes; anything else returns at once.
 * A record without an array `_translations`, as under a narrowing `select`, stays untouched.
 */
export async function scopeTranslations(
  records: readonly Record<string, unknown>[],
  collection: string,
  meta: CollectionQueryMeta,
  scope: QueryScope,
): Promise<void> {
  const { where } = scope;
  if (meta.translatable !== true || isUndefined(where) || !localeSensitive(where, meta)) return;
  const carrying: { record: Record<string, unknown>; uuid: string; held: string[] }[] = [];
  for (const record of records) {
    const { UUID, _translations } = record;
    if (isString(UUID) && isArray<string[]>(_translations)) {
      carrying.push({ record, uuid: UUID, held: _translations });
    }
  }
  if (isEmpty(carrying)) return;
  const visible = await visibleLocales(
    collection,
    meta,
    where,
    carrying.map((entry) => entry.uuid),
  );
  for (const { record, uuid, held } of carrying) {
    record._translations = held.filter((locale) => visible.get(locale)?.has(uuid) === true);
  }
}

/**
 * The `UUID`s among `uuids` the scope `where` admits at each configured locale.
 * Each locale probes once per chunk, selecting `UUID` alone under `{ where }`.
 * The scope's `select` would drop the key and its `limit` would cap the probe, so neither rides.
 */
export async function visibleLocales(
  collection: string,
  meta: CollectionQueryMeta,
  where: Defined<QueryScope['where']>,
  uuids: readonly string[],
): Promise<Map<string, Set<string>>> {
  const visible = new Map<string, Set<string>>();
  for (const locale of queryLocales().locales) {
    const admitted = new Set<string>();
    const parsed = parseQueryParams({ select: 'UUID', locale }, meta, resolveGuards());
    for (const batch of chunk(uuids, 900)) {
      const rows = await applyQuery(
        queryUntyped(collection).where({ UUID: { in: batch } }),
        parsed,
        { where },
      ).findMany();
      for (const row of rows) admitted.add(row.UUID as string);
    }
    visible.set(locale, admitted);
  }
  return visible;
}

/**
 * Whether a scope `where` can admit a record at one locale and hide it at another.
 * A leaf over a companion field reads that locale's value; a `has` or `empty` reaches per-locale rows.
 * A condition over plain columns alone answers alike at every locale.
 * An unparsable condition counts as sensitive; the read it scopes has already refused it.
 */
function localeSensitive(where: Defined<QueryScope['where']>, meta: CollectionQueryMeta): boolean {
  const parsed = parseCondition(where);
  if (!parsed.ok) return true;
  let sensitive = false;
  walkCondition(parsed.node, (node) => {
    if (node.kind === 'has' || node.kind === 'empty') sensitive = true;
    else if (node.kind === 'compare' && meta.fields[node.path[0]]?.companion === true) {
      sensitive = true;
    }
  });
  return sensitive;
}

/**
 * Narrows a write's answered record to the operation's `select` scope, matching what a read returns.
 * An unselective scope answers the record whole.
 */
export function scopedRecord(
  record: Record<string, unknown>,
  scope: QueryScope,
): Record<string, unknown> {
  return isUndefined(scope.select) ? record : pick(record, scope.select);
}

/**
 * Reads a write request's params: `locale` is the only one a write takes, validated as a read's is.
 * Any other param rejects `400`, never ignored.
 */
export function writeLocale(meta: CollectionQueryMeta): string | null {
  const params = useSearchParams();
  for (const key of Object.keys(params)) {
    if (key !== 'locale') throw unknownParamError(key);
  }
  return parseLocaleParam(params.locale, meta);
}

/**
 * Reads a by-`UUID` read's params: `select`, `populate`, and `locale` shape one record.
 * A windowing, ordering, or filtering param rejects `400` - the `UUID` already pins the row.
 */
export function recordParams(): Record<string, SearchParamValue> {
  const params = useSearchParams();
  for (const key of Object.keys(params)) {
    if (key !== 'select' && key !== 'populate' && key !== 'locale') throw unknownParamError(key);
  }
  return params;
}

/**
 * Rejects every param: the endpoint takes none.
 */
export function assertNoParams(): void {
  for (const key of Object.keys(useSearchParams())) throw unknownParamError(key);
}

/**
 * The kebab segment -> collection memo, built once per process.
 * Collections register at boot, before the server serves, so the memo holds - as `queryMetadata`'s does.
 * Dev respawn restarts the process, which is the invalidation.
 */
let segments: Map<string, CollectionMeta> | null = null;

/**
 * The registered collection whose kebab-case name is `segment`, or `undefined`.
 */
function collectionBySegment(segment: string): CollectionMeta | undefined {
  if (isNull(segments)) {
    segments = new Map();
    for (const meta of Object.values(useCollections().all())) {
      segments.set(toKebabCase(meta.name), meta);
    }
  }
  return segments.get(segment);
}
