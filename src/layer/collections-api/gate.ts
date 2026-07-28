import type {
  CollectionAPI,
  CollectionEndpoint,
  CollectionMeta,
  CollectionQueryMeta,
  MiddlewareKey,
  ParsedQuery,
} from 'ohne';
import type { SearchParamValue } from 'ohne/utils';

import {
  applyQuery,
  parseLocaleParam,
  queryUntyped,
  useCollections,
  useEvent,
  useMiddleware,
  useSearchParams,
} from 'ohne';
import { isBoolean, isNull, isUndefined, toKebabCase } from 'ohne/utils';

import { ohneError } from '../../ohne/error/ohne-error.ts';
import { notFound } from '../../ohne/http/http-error.ts';
import { unknownParamError } from '../../ohne/query/wire/errors.ts';

/**
 * One collections-API operation, as the `api` exposure names it.
 */
export type CollectionOperation = 'read' | 'create' | 'update' | 'delete';

/**
 * A passed gate carries the resolved collection name; a failed one the middleware's answer.
 */
export type CollectionGate = { ok: true; collection: string } | { ok: false; response: unknown };

/**
 * The page size a paginated list read takes when the request names `page` without `perPage`.
 */
export const LIST_PER_PAGE = 20;

/**
 * Resolves a route's collection segment and admits the request into one operation.
 *
 * The segment is the collection's kebab-case name.
 * An unknown collection, an unexposed one, and a closed operation all answer the identical `404`.
 * The API therefore reveals nothing about what exists.
 * The operation's named middleware then run in order, exactly as route middleware do.
 * Each records on the event; a returned value answers the request without the operation running.
 * An unknown middleware name throws - a misconfigured exposure is a `500`, never an open door.
 */
export async function gateCollection(
  segment: string,
  operation: CollectionOperation,
): Promise<CollectionGate> {
  const meta = collectionBySegment(segment);
  const endpoint = isUndefined(meta) ? undefined : operationOf(meta.collection.api, operation);
  if (isUndefined(meta) || isUndefined(endpoint)) throw notFound();
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
  return { ok: true, collection: meta.name };
}

/**
 * Pins a list read's terminal: `paginate` when the request names a page, `findMany` otherwise.
 * Shared by the `GET` list and the `POST` body-query endpoint, so both transports read identically.
 */
export function listRecords(collection: string, parsed: ParsedQuery): Promise<unknown> {
  const builder = applyQuery(queryUntyped(collection), parsed);
  if (isNull(parsed.page) && isNull(parsed.perPage)) return builder.findMany();
  return builder.paginate(parsed.page ?? 1, parsed.perPage ?? LIST_PER_PAGE);
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

/**
 * Resolves one operation's endpoint options from the `api` exposure, or `undefined` when closed.
 * The `'public'` shorthand resolves to `{ public: true }`, so the gate reads one shape.
 */
function operationOf(
  api: boolean | CollectionAPI | undefined,
  operation: CollectionOperation,
): CollectionEndpoint | undefined {
  if (isBoolean(api) || isUndefined(api)) return api === true ? {} : undefined;
  const value = api[operation];
  if (isBoolean(value) || isUndefined(value)) return value === true ? {} : undefined;
  return value === 'public' ? { public: true } : value;
}
