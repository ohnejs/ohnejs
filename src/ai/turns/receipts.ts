import type { CollectionQueryMeta, ParsedQuery } from 'ohnejs';
import type { ConditionNode } from 'ohnejs/utils';

import { parseLocaleParam, queryMetadata, resolveGuards } from 'ohnejs';
import {
  groupBy,
  isArray,
  isEmpty,
  isInteger,
  isNull,
  isPlainObject,
  isString,
  isUndefined,
  isUUID,
  mapValues,
  parseCondition,
} from 'ohnejs/utils';

import type { Proposal } from './proposals.ts';
import type { OfferedRoute, ReachableCollection } from './surface.ts';

import { useAIConfig } from '../config.ts';
import { redactRecords, SYSTEM_FIELDS } from './redact.ts';

/**
 * The surface's collections, as the identity rule reads their opened fields.
 */
type Opened = ReadonlyMap<string, Pick<ReachableCollection, 'opened'>>;

/**
 * One reported search hit: its collection and id, and the collection its `via` names.
 */
type SearchHit = { collection: string; UUID: string; via?: string };

/**
 * One verdict as a receipt carries it: the rows named, or their count.
 */
export type ReceiptVerdict = {
  /**
   * The rows the operation may touch, named only when the asked rows were named by id.
   */
  UUIDs?: string[];

  /**
   * How many of the asked rows the operation may touch.
   */
  total?: number;

  /**
   * The fields an update may write, when its scope limits them.
   */
  select?: string[];
};

/**
 * What a search found in one collection, or through one target collection.
 */
export type ReceiptFound = {
  /**
   * The records found, named only where `ai.data` opens every collection that matched their text.
   */
  UUIDs?: string[];

  /**
   * How many records this page of the search found, at most its `limit`, where their ids stay unnamed.
   */
  total?: number;
};

/**
 * What the model reads back for one proposal: status, counts and ids.
 * Values ride only as `records`, for a collection `ai.data` opens, and only what the person may read.
 */
export interface Receipt {
  /**
   * The proposal's route id, echoed.
   */
  route: string;

  /**
   * The `uuid` param the proposal named, or the `UUID` a create answered.
   */
  uuid?: string;

  /**
   * The answer's status, or `400` for a proposal the server refused before it was sent.
   * `0` when the connection dropped before the answer, so the request may have run.
   * Absent when the person declined the proposal.
   */
  status?: number;

  /**
   * The wire error code of a `400`, or the reason a refused proposal was never sent.
   */
  code?: string;

  /**
   * The dot path a `400` locates its failure at.
   */
  path?: string;

  /**
   * The field paths a `422` lists as failing.
   */
  errors?: string[];

  /**
   * How many records a list answered, or how many a write by set touched.
   */
  total?: number;

  /**
   * The ids a list answered, only when its filter and order named identity fields alone.
   */
  UUIDs?: string[];

  /**
   * What a search found directly, by collection: a count, and the ids where `ai.data` opens the collection.
   */
  found?: Record<string, ReceiptFound>;

  /**
   * What a search found through links, by collection, then by the target collection a word matched in.
   * The ids are named only where `ai.data` opens both collections, since the target holds the text matched.
   */
  related?: Record<string, Record<string, ReceiptFound>>;

  /**
   * The locales a record holds, from a translations read.
   */
  locales?: string[];

  /**
   * What a verdicts read answered, per operation.
   */
  verdicts?: Record<string, ReceiptVerdict>;

  /**
   * The records a `2xx` answered, only for a collection `ai.data` opens, cut to what the model may see.
   */
  records?: Record<string, unknown>[];

  /**
   * Set when `records` was cut at `ai.limits.resultSize`, or a search left related groups out.
   */
  truncated?: true;

  /**
   * How many records a transform rewrote and the person sent.
   */
  transformed?: number;

  /**
   * How many records a transform reached but did not write: skipped, left unchecked, or failed.
   */
  skipped?: number;

  /**
   * How many records a transform matched past its limit and never read, to propose again.
   */
  unreached?: number;

  /**
   * Set when the person declined the proposal.
   */
  declined?: true;

  /**
   * What the person said when declining.
   */
  note?: string;
}

/**
 * What the browser reports for one proposal: the answer it got, or the person's decline.
 */
export type BatchResult =
  | {
      /**
       * The answer's status, `0` when the connection dropped before it.
       */
      status: number;

      /**
       * The answer's JSON body, when it had one.
       */
      body?: unknown;

      /**
       * Set when the browser sent the request without asking, as the proposal's `auto` allowed.
       */
      auto?: true;
    }
  | {
      /**
       * The person declined the proposal.
       */
      declined: true;

      /**
       * What the person said.
       */
      note?: string;
    };

/**
 * What shaping a receipt needs of an accepted proposal.
 */
export interface ReceiptSource {
  /**
   * The parts of the offered route a receipt is shaped by.
   */
  route: Pick<OfferedRoute, 'method' | 'pattern' | 'body' | 'collection'>;

  /**
   * The proposal as the browser received it.
   */
  proposal: Proposal;

  /**
   * Whether the proposal's filter passed the identity rule, so the receipt may list ids.
   */
  identity: boolean;
}

/**
 * The longest code or field path a receipt repeats from a reported body.
 */
const MAX_TEXT = 256;

/**
 * The most failing field paths a receipt repeats.
 */
const MAX_ERRORS = 100;

/**
 * The most record ids a replayed read keeps, as many as the palette names in one read line.
 */
const REPLAY_IDS = 12;

/**
 * The counts a replayed body keeps.
 */
const REPLAY_COUNTS = ['total', 'failed', 'unknown', 'transformed'] as const;

/**
 * The part of a reported body a chat replays: its counts and record ids, never a value.
 * `records` keeps the first ids as `{ UUID }`; a body that is itself a record keeps its `UUID`.
 * A search keeps the first `{ collection, UUID }` pairs of each collection, and of each related group.
 * A related pair keeps its `via` as `{ collection }`, never a label or a path.
 * Its `found` counts the direct hits per collection, and `related` the others per collection and target.
 * `undefined` when nothing is left.
 *
 * @example
 * ```ts
 * replayBody({ total: 2, records: [{ UUID: A, name: 'Thrall' }, { UUID: B }] })
 * // -> { total: 2, records: [{ UUID: A }, { UUID: B }] }
 *
 * replayBody({ UUID: A, name: 'Thrall' })
 * // -> { UUID: A }
 *
 * replayBody({ name: 'Thrall' })
 * // -> undefined
 * ```
 */
export function replayBody(body: unknown): Record<string, unknown> | undefined {
  if (!isPlainObject(body)) return undefined;
  const kept: Record<string, unknown> = {};
  for (const key of REPLAY_COUNTS) {
    if (isInteger(body[key])) kept[key] = body[key];
  }
  if (isUUID(body.UUID)) kept.UUID = body.UUID;
  if (isArray(body.records)) {
    kept.records = body.records
      .map((record) => (isPlainObject(record) ? record.UUID : undefined))
      .filter(isUUID)
      .slice(0, REPLAY_IDS)
      .map((UUID) => ({ UUID }));
  }
  if (isArray(body.results)) {
    const hits = searchHits(body.results);
    const grouped = groupBy(hits, (hit) => `${hit.collection}\n${hit.via ?? ''}`);
    kept.results = Object.values(grouped).flatMap((group = []) =>
      group
        .slice(0, REPLAY_IDS)
        .map(({ collection, UUID, via }) =>
          isUndefined(via) ? { collection, UUID } : { collection, UUID, via: { collection: via } },
        ),
    );
    const counts = searchCounts(hits, (group) => group.length);
    kept.found = counts.found;
    if (!isEmpty(counts.related)) kept.related = counts.related;
  }
  return isEmpty(kept) ? undefined : kept;
}

/**
 * The receipt of a proposal the server refuses before the browser sees it, shaped as a `400`.
 *
 * @example
 * ```ts
 * refusal('GET /collections/items/[uuid]', 'invalidValue', 'params.uuid')
 * // -> { route: 'GET /collections/items/[uuid]', status: 400, code: 'invalidValue', path: 'params.uuid' }
 * ```
 */
export function refusal(route: string, code: string, path?: string): Receipt {
  return { route, status: 400, code, ...(isUndefined(path) ? {} : { path }) };
}

/**
 * Shapes what the browser reported for an accepted proposal into the receipt the model reads.
 * A `2xx` carries counts, and ids when the proposal's filter passed the identity rule.
 * With `values`, it also carries the records it answered, redacted, for a collection `ai.data` opens.
 * A `400` carries its code and path, a `422` its failing field paths; any other status stands alone.
 * A write by set carries the rows it wrote whatever its status, since a failed row never undoes the rest.
 * A transform likewise carries the records it rewrote and the ones it did not.
 * A decline carries the person's note.
 * Nothing else of the body reaches the model.
 * Valid only within a request.
 */
export async function shapeReceipt(
  source: ReceiptSource,
  result: BatchResult,
  values = false,
): Promise<Receipt> {
  const { route, proposal, identity } = source;
  const receipt: Receipt = { route: proposal.route };
  const uuid = proposal.params?.uuid;
  if (!isUndefined(uuid)) receipt.uuid = uuid;
  if ('declined' in result) {
    receipt.declined = true;
    if (!isUndefined(result.note)) receipt.note = result.note;
    return receipt;
  }
  receipt.status = result.status;
  const body = isPlainObject(result.body) ? result.body : undefined;
  const data = isPlainObject(body?.data) ? body.data : undefined;
  if (!isUndefined(proposal.transform)) {
    if (isInteger(body?.transformed)) receipt.transformed = body.transformed;
    if (isInteger(body?.skipped)) receipt.skipped = body.skipped;
    if (isInteger(body?.unreached) && body.unreached > 0) receipt.unreached = body.unreached;
  } else if (!isUndefined(proposal.where) && isInteger(body?.total)) {
    receipt.total = body.total;
  }
  if (result.status === 400 && !isUndefined(data)) {
    if (isString(data.code)) receipt.code = data.code.slice(0, MAX_TEXT);
    if (isString(data.path)) receipt.path = data.path.slice(0, MAX_TEXT);
  } else if (result.status === 422 && isPlainObject(data?.errors)) {
    receipt.errors = Object.keys(data.errors)
      .slice(0, MAX_ERRORS)
      .map((path) => path.slice(0, MAX_TEXT));
  } else if (result.status >= 200 && result.status < 300) {
    if (route.body === 'query') shapeList(receipt, result.body, identity);
    if (route.body === 'verdicts' && !isUndefined(body)) shapeVerdicts(receipt, body, identity);
    if (route.body === 'search') shapeSearch(receipt, body, values);
    if (route.body === 'record' && route.method === 'POST' && isString(body?.UUID)) {
      receipt.uuid = body.UUID;
    }
    if (route.pattern.endsWith('/translations') && isArray(body?.locales)) {
      receipt.locales = body.locales.filter(isString);
    }
    const { collection } = route;
    const records = values && !isUndefined(collection) ? answeredRecords(result.body) : null;
    if (!isNull(records) && !isUndefined(collection)) {
      const locale = readLocale(source, collection);
      Object.assign(receipt, await redactRecords(records, collection, locale));
    }
  }
  return receipt;
}

/**
 * Whether a parsed query names identity fields alone, so its ids may reach the model.
 * Every `where` leaf and `order` field must be `UUID`, `_updatedAt`, `_translations` or an opened field.
 * The opened fields are those `collections`, the turn's surface, gives each collection.
 * A `has` into a relation recurses with the target's own list; any other `has` names its own field.
 * A leaf that climbs or anchors its path never passes.
 */
export function identityOnly(
  parsed: Pick<ParsedQuery, 'where' | 'order'>,
  collection: string,
  collections: Opened,
): boolean {
  const meta = queryMetadata(collection);
  if (!parsed.order.every((entry) => identityField(meta, entry.field, collections))) return false;
  if (isNull(parsed.where)) return true;
  const condition = parseCondition(parsed.where);
  return condition.ok && identityCondition(condition.node, meta, collections);
}

/**
 * Whether every leaf of `node` names an identity field of `meta`, recursing through relation `has`.
 */
function identityCondition(
  node: ConditionNode,
  meta: CollectionQueryMeta,
  collections: Opened,
): boolean {
  if (node.kind === 'and' || node.kind === 'or') {
    return node.nodes.every((child) => identityCondition(child, meta, collections));
  }
  const [name] = node.path;
  if (name.startsWith('/') || name === '..') return false;
  const field = meta.fields[name];
  if (isUndefined(field)) return false;
  const relation = field.kind === 'record' || field.kind === 'records';
  if (node.kind === 'has' && relation && !isNull(node.condition)) {
    return identityCondition(node.condition, queryMetadata(field.target as string), collections);
  }
  return identityField(meta, name, collections);
}

/**
 * Whether `name` is a system field of the collection, or one the surface opens on it.
 */
function identityField(meta: CollectionQueryMeta, name: string, collections: Opened): boolean {
  return (
    SYSTEM_FIELDS.has(name) || collections.get(meta.collection)?.opened.includes(name) === true
  );
}

/**
 * The records a `2xx` body answered: a list under `records`, a bare list, or the one record it is.
 * `null` for a body without records, like a count or a locale list.
 */
function answeredRecords(body: unknown): unknown[] | null {
  if (isArray(body)) return body;
  if (!isPlainObject(body)) return null;
  if (isArray(body.records)) return body.records;
  return isString(body.UUID) ? [body] : null;
}

/**
 * The locale the proposal read `collection` at: a list read names it in the body, any other in the query.
 * Proposals are checked before they are sent, so the value is a configured locale or absent.
 */
function readLocale({ route, proposal }: ReceiptSource, collection: string): string | null {
  const value = route.body === 'query' ? proposal.body?.locale : proposal.query?.locale;
  return isString(value) ? parseLocaleParam(value, queryMetadata(collection)) : null;
}

/**
 * Fills a list receipt: the total, and the ids when the filter passed the identity rule.
 * A body that is a bare list counts its length.
 */
function shapeList(receipt: Receipt, body: unknown, identity: boolean): void {
  const records = isArray(body) ? body : isPlainObject(body) ? body.records : undefined;
  if (isPlainObject(body) && isInteger(body.total)) receipt.total = body.total;
  else if (isArray(records)) receipt.total = records.length;
  if (identity && isArray(records)) {
    receipt.UUIDs = reportedUUIDs(
      records.map((record) => (isPlainObject(record) ? record.UUID : undefined)),
    );
  }
}

/**
 * Fills a search receipt: direct hits per collection, related ones per collection and target.
 * Each carries a count always, the ids only where `ai.data` opens every collection matched.
 * A search matches any text field, so its ids would tell a hidden field's text.
 * A hit in or through a collection `ai.deny` names never appears, not even in a count.
 */
function shapeSearch(
  receipt: Receipt,
  body: Record<string, unknown> | undefined,
  values: boolean,
): void {
  const { data, deny } = useAIConfig();
  const denied = new Set(deny.collections);
  const hits = searchHits(isArray(body?.results) ? body.results : []).filter(
    ({ collection, via }) => !denied.has(collection) && (isUndefined(via) || !denied.has(via)),
  );
  const { found, related } = searchCounts(hits, (group, collection, via) => {
    const uuids = reportedUUIDs(group.map((hit) => hit.UUID));
    const open = values && data[collection] === true && (isUndefined(via) || data[via] === true);
    return open ? { UUIDs: uuids } : { total: uuids.length };
  });
  receipt.found = found;
  if (isEmpty(related)) return;
  receipt.related = related;
  // Beside no kept group, a cut would hint at groups the model may not see.
  if (body?.truncated === true) receipt.truncated = true;
}

/**
 * The well-formed hits of a reported search, each with the collection its `via` names.
 */
function searchHits(results: readonly unknown[]): SearchHit[] {
  return results.filter(isPlainObject).flatMap(({ collection, UUID, via }) => {
    if (!isString(collection) || !isUUID(UUID)) return [];
    if (isUndefined(via)) return [{ collection, UUID }];
    return isPlainObject(via) && isString(via.collection)
      ? [{ collection, UUID, via: via.collection }]
      : [];
  });
}

/**
 * Tallies hits with `count`: the direct ones by collection, the related ones by collection and target.
 */
function searchCounts<T>(
  hits: readonly SearchHit[],
  count: (group: SearchHit[], collection: string, via?: string) => T,
): { found: Record<string, T>; related: Record<string, Record<string, T>> } {
  const found: Record<string, T> = {};
  const related: Record<string, Record<string, T>> = {};
  for (const [collection, group = []] of Object.entries(groupBy(hits, (hit) => hit.collection))) {
    const direct = group.filter((hit) => isUndefined(hit.via));
    if (!isEmpty(direct)) found[collection] = count(direct, collection);
    const linked = groupBy(
      group.filter((hit) => !isUndefined(hit.via)),
      (hit) => hit.via as string,
    );
    if (isEmpty(linked)) continue;
    related[collection] = mapValues(linked, (via, through = []) => count(through, collection, via));
  }
  return { found, related };
}

/**
 * Fills a verdicts receipt per operation: a count always, the rows only when the model named them.
 */
function shapeVerdicts(receipt: Receipt, body: Record<string, unknown>, identity: boolean): void {
  const verdicts: Record<string, ReceiptVerdict> = {};
  for (const [operation, value] of Object.entries(body)) {
    if (!isPlainObject(value)) continue;
    const verdict: ReceiptVerdict = {};
    if (isArray(value.UUIDs)) {
      const uuids = reportedUUIDs(value.UUIDs);
      if (identity) verdict.UUIDs = uuids;
      else verdict.total = uuids.length;
    } else if (isInteger(value.total)) {
      verdict.total = value.total;
    }
    if (isArray(value.select)) verdict.select = value.select.filter(isString);
    verdicts[operation] = verdict;
  }
  receipt.verdicts = verdicts;
}

/**
 * The ids among reported values, as many as one read may answer; a browser reports, it never proves.
 */
function reportedUUIDs(values: readonly unknown[]): string[] {
  return values.filter(isUUID).slice(0, resolveGuards().maxLimit);
}
