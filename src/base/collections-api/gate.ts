import type {
  AccessContext,
  CollectionEndpoint,
  CollectionMeta,
  CollectionOperation,
  CollectionQueryMeta,
  Event,
  MiddlewareKey,
  ParsedQuery,
  QueryScope,
} from 'ohnejs';
import type { Defined, SearchParamValue } from 'ohnejs/utils';

import {
  admittedUUIDs,
  applyQuery,
  endpointOf,
  parseLocaleParam,
  queryUntyped,
  readRecordBody,
  resolveAccess,
  useCollections,
  useEvent,
  useMiddleware,
  useSearchParams,
} from 'ohnejs';
import { isNull, isUndefined, pick, toKebabCase } from 'ohnejs/utils';

import { ohneError } from '../../ohne/error/ohne-error.ts';
import { HTTPError, notFound } from '../../ohne/http/http-error.ts';
import { queryLocales } from '../../ohne/query/locale.ts';
import { unknownParamError } from '../../ohne/query/wire/errors.ts';
import { requireCapability, userCan } from '../auth/capabilities.ts';
import { useUser } from '../auth/use-user.ts';

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
  const response = await runMiddleware(endpoint, meta.name);
  if (!isUndefined(response)) return { ok: false, response };
  return { ok: true, collection: meta.name, endpoint };
}

/**
 * Runs an endpoint's named middleware in order, exactly as route middleware do.
 * The first value one returns is the answer; `undefined` means every middleware passed.
 */
async function runMiddleware(
  endpoint: Pick<CollectionEndpoint, 'middleware'>,
  collection: string,
): Promise<unknown> {
  const event = useEvent();
  for (const name of endpoint.middleware ?? []) {
    const middleware = useMiddleware().get(name);
    if (isUndefined(middleware)) {
      throw ohneError(
        `Collection \`${collection}\` names unknown middleware \`${name}\` in its \`api\` exposure`,
      );
    }
    event.appliedMiddleware.push(name as MiddlewareKey);
    const result = await middleware(event);
    if (!isUndefined(result)) return result;
  }
  return undefined;
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
  if (operation === 'read') requestReaches().set(admitted.collection, Promise.resolve(scope));
  return { ok: true, collection: admitted.collection, scope };
}

/**
 * The caller's read reach into a collection a wire query crosses into, memoized per request.
 * A closed read, a guarded one the caller lacks the capability for, and a `false` verdict reach nothing.
 * The target's named middleware run as its own read would run them; one that answers makes it unreachable.
 * A read gate seeds its own collection's reach, so a self-crossing read resolves its scope once.
 * The shipped read endpoints hand this to `parseWireQuery`, so a populate or `has` never widens a read.
 */
export function readReach(collection: string): Promise<QueryScope | false> {
  const memo = requestReaches();
  let reach = memo.get(collection);
  if (isUndefined(reach)) {
    reach = resolveReadReach(collection);
    memo.set(collection, reach);
  }
  return reach;
}

/**
 * The caller's reach for linking into a collection: its read reach.
 * Into `Users` it also reaches the caller's own account, so a record can name its author.
 * The shipped create and update endpoints hand this to `linkReach`, so a link never reveals a hidden record.
 */
export async function linkReach(collection: string): Promise<QueryScope | false> {
  const reach = await readReach(collection);
  if (collection !== 'Users') return reach;
  const user = await useUser();
  if (isNull(user)) return reach;
  const me = { UUID: user.UUID };
  if (reach === false) return { where: me };
  return isUndefined(reach.where) ? reach : { where: { or: [reach.where, me] } };
}

/**
 * The caller's reach into a collection's update or delete, as a verdict asks it before any write runs.
 * A closed operation, a guarded one the caller lacks the capability for, and a `false` verdict reach nothing.
 * The operation's middleware never run: asking must not fire a write's rate limiter or audit log.
 * An update resolves with an empty input, so it answers whether the caller may touch the row at all.
 * An `HTTPError` the resolver throws reaches nothing, as the write itself would refuse the caller.
 * Any other throw propagates, so a misconfigured scope is a `500`, never an open door.
 */
export async function writeReach(
  collection: string,
  operation: 'update' | 'delete',
): Promise<QueryScope | false> {
  const endpoint = await reachedEndpoint(collection, operation);
  if (isUndefined(endpoint)) return false;
  return verdictScope(endpoint, operation === 'update' ? { operation, input: {} } : { operation });
}

/**
 * The caller's reach into a collection's read, as a verdict asks it before any read runs.
 * A closed read, a guarded one the caller lacks the capability for, and a `false` verdict reach nothing.
 * The read's middleware never run: asking must not fire a read's rate limiter or audit log.
 * `readReach` is the read itself, middleware included, and memoized; this is the question asked first.
 * An `HTTPError` the resolver throws reaches nothing, as the read itself would refuse the caller.
 * Any other throw propagates, so a misconfigured scope is a `500`, never an open door.
 */
export async function readScope(collection: string): Promise<QueryScope | false> {
  const endpoint = await reachedEndpoint(collection, 'read');
  if (isUndefined(endpoint)) return false;
  return verdictScope(endpoint, { operation: 'read' });
}

/**
 * Resolves an endpoint's `access` for a verdict: an `HTTPError` reaches nothing, any other throw propagates.
 */
async function verdictScope<O extends CollectionOperation>(
  endpoint: CollectionEndpoint<string, O>,
  context: AccessContext<O>,
): Promise<QueryScope | false> {
  try {
    return await resolveAccess(endpoint, context);
  } catch (error) {
    if (error instanceof HTTPError) return false;
    throw error;
  }
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
 * Pins a list read's terminal: `paginate` when the request names `page` or `perPage`, `findMany` otherwise.
 * Shared by the `GET` list and the `POST` body-query endpoint, so both transports read identically.
 * The gate's access scope composes in, narrowing the rows, fields, and `_translations` the request may reach.
 */
export function listRecords(
  collection: string,
  parsed: ParsedQuery,
  scope: QueryScope,
): Promise<unknown> {
  const builder = applyQuery(queryUntyped(collection), parsed, scope);
  if (isNull(parsed.page) && isNull(parsed.perPage)) return builder.findMany();
  return builder.paginate(parsed.page ?? 1, parsed.perPage ?? LIST_PER_PAGE);
}

/**
 * The `UUID`s among `uuids` the scope `where` admits at each configured locale.
 */
export async function visibleLocales(
  collection: string,
  meta: CollectionQueryMeta,
  where: Defined<QueryScope['where']>,
  uuids: readonly string[],
): Promise<Map<string, Set<string>>> {
  const visible = new Map<string, Set<string>>();
  for (const locale of queryLocales().locales) {
    visible.set(locale, await admittedUUIDs(collection, meta, where, uuids, locale));
  }
  return visible;
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
 * Each request's resolved reaches, so one collection's read resolves once however often a query crosses it.
 */
const reaches = new WeakMap<Event, Map<string, Promise<QueryScope | false>>>();

/**
 * The current request's reach memo, created on first use.
 */
function requestReaches(): Map<string, Promise<QueryScope | false>> {
  const event = useEvent();
  let memo = reaches.get(event);
  if (isUndefined(memo)) {
    memo = new Map();
    reaches.set(event, memo);
  }
  return memo;
}

/**
 * Resolves the caller's read reach into one collection through the same rules the read gate applies.
 */
async function resolveReadReach(collection: string): Promise<QueryScope | false> {
  const endpoint = await reachedEndpoint(collection, 'read');
  if (isUndefined(endpoint)) return false;
  if (!isUndefined(await runMiddleware(endpoint, collection))) return false;
  return resolveAccess(endpoint, { operation: 'read' });
}

/**
 * The operation's endpoint when the caller may run it, `undefined` otherwise.
 * The operation must be exposed, and either `public` or covered by the caller's capabilities.
 */
async function reachedEndpoint<O extends CollectionOperation>(
  collection: string,
  operation: O,
): Promise<CollectionEndpoint<string, O> | undefined> {
  const endpoint = endpointOf(useCollections().get(collection)?.collection.api, operation);
  if (isUndefined(endpoint) || endpoint.public === true) return endpoint;
  const user = await useUser();
  return !isNull(user) && userCan(user, `collection.${collection}.${operation}`)
    ? endpoint
    : undefined;
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
