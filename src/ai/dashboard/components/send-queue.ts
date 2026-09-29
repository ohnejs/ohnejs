import {
  fillRoute,
  isArray,
  isPlainObject,
  isString,
  isUndefined,
  parseRetryAfter,
  parseRouteID,
  stringifySearchParams,
} from 'ohnejs/utils';

import type { BatchResult, Proposal, TurnBatch } from './turn-store.ts';

/**
 * What the queue sends through: the dashboard's `api` and a sleep it can wait on.
 * Injected, so the queue runs the same under a test double.
 */
export interface SendTransport {
  /**
   * Fetches a route as `api` from `ohnejs/dashboard` does.
   */
  api(route: string, init?: RequestInit): Promise<Response>;

  /**
   * Waits `ms` milliseconds.
   */
  sleep(ms: number): Promise<void>;
}

/**
 * What the person decided for one proposal.
 * A write by set names the rows to write; without them nothing is sent.
 */
export type Approval =
  | {
      /**
       * Send the proposal.
       */
      send: true;

      /**
       * The rows a write by set writes, in order.
       */
      UUIDs?: readonly string[];
    }
  | {
      /**
       * Decline the proposal.
       */
      send: false;

      /**
       * What the person said.
       */
      note?: string;
    };

/**
 * One request as the queue sends it.
 */
export interface OutgoingRequest {
  /**
   * The route id with its params filled and its query attached: `PATCH /collections/items/<uuid>?locale=de`.
   */
  route: string;

  /**
   * The fetch options: the JSON body and its content type, when the proposal carries a body.
   */
  init: RequestInit;
}

/**
 * The answer one request got.
 */
export interface Answer {
  /**
   * The answer's status.
   */
  status: number;

  /**
   * The answer's JSON body, `undefined` when it had none.
   */
  body?: unknown;
}

/**
 * Options for `sendBatch`.
 */
export interface SendOptions {
  /**
   * The most bytes one answer may carry into the results post; a list is cut to fit.
   */
  limit: number;

  /**
   * Called before the first request and after each one, with the requests sent and the requests in all.
   */
  onProgress?(sent: number, total: number): void;
}

/**
 * How many times one request is tried before its answer stands.
 */
const ATTEMPTS = 3;

/**
 * The wait before a rerun when the answer names none, in milliseconds.
 */
const DEFAULT_WAIT = 1000;

/**
 * The longest wait a `Retry-After` may ask for; a longer one makes the answer stand.
 */
const MAX_WAIT = 30_000;

const posted = new Set<string>();

const encoder = new TextEncoder();

/**
 * The request a proposal sends: its pattern filled from `params`, its query attached, its body as JSON.
 * `uuid` fills the `[uuid]` of a write by set, one request per row.
 *
 * @example
 * ```ts
 * requestOf({ route: 'PATCH /collections/items/[uuid]', tier: 'write', where: {}, body: { level: 1 } }, 'a')
 * // -> { route: 'PATCH /collections/items/a', init: { headers: {...}, body: '{"level":1}' } }
 * ```
 */
export function requestOf(proposal: Proposal, uuid?: string): OutgoingRequest {
  const { method, path } = parseRouteID(proposal.route);
  const params = { ...proposal.params, ...(isUndefined(uuid) ? {} : { uuid }) };
  const search = isUndefined(proposal.query) ? '' : stringifySearchParams(proposal.query);
  const route = `${method ?? 'GET'} ${fillRoute(path, params)}${search === '' ? '' : `?${search}`}`;
  const init: RequestInit = isUndefined(proposal.body)
    ? {}
    : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(proposal.body) };
  return { route, init };
}

/**
 * Fetches `route`, trying again after a `429` or `503` for as long as its `Retry-After` allows.
 * An answer without the header waits a second; one asking past `MAX_WAIT` stands as it is.
 * A network failure throws at once: the request may have landed, and a write must never run twice.
 */
export async function fetchWithRetry(
  transport: SendTransport,
  route: string,
  init?: RequestInit,
): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    const response = await transport.api(route, init);
    if ((response.status !== 429 && response.status !== 503) || attempt >= ATTEMPTS) {
      return response;
    }
    const wait = parseRetryAfter(response.headers.get('retry-after')) ?? DEFAULT_WAIT;
    if (wait > MAX_WAIT) return response;
    await transport.sleep(wait);
  }
}

/**
 * Sends one request and reads its answer; a body that is not JSON reads as none.
 */
export async function sendRequest(
  transport: SendTransport,
  request: OutgoingRequest,
): Promise<Answer> {
  const response = await fetchWithRetry(transport, request.route, request.init);
  if (response.status === 204) return { status: response.status };
  const body: unknown = await response.json().catch(() => undefined);
  return isUndefined(body) ? { status: response.status } : { status: response.status, body };
}

/**
 * Cuts an answer to what the receipt reads, so nothing else reaches the server.
 * A `2xx` keeps its body, its list of records cut at `limit` bytes; a `204` carries none.
 * Any other status keeps the `message` and the `code`, `path` and `errors` under `data`.
 *
 * @example
 * ```ts
 * shapeResult(422, { statusCode: 422, message: 'Invalid', data: { errors: { name: 'Required' } } }, 1024)
 * // -> { status: 422, body: { message: 'Invalid', data: { errors: { name: 'Required' } } } }
 * ```
 */
export function shapeResult(status: number, body: unknown, limit: number): Answer {
  if (status >= 200 && status < 300) {
    return isUndefined(body) ? { status } : { status, body: cutRecords(body, limit) };
  }
  if (!isPlainObject(body)) return { status };
  const shaped: Record<string, unknown> = {};
  if (isString(body.message)) shaped.message = body.message;
  if (isPlainObject(body.data)) {
    const data: Record<string, unknown> = {};
    for (const key of ['code', 'path', 'errors'] as const) {
      if (!isUndefined(body.data[key])) data[key] = body.data[key];
    }
    shaped.data = data;
  }
  return { status, body: shaped };
}

/**
 * Folds the answers of a write by set into one result: how many rows it wrote, and the first failure.
 * Every row written answers `200`; otherwise the first failing answer's status and body lead.
 *
 * @example
 * ```ts
 * foldSet([{ status: 200 }, { status: 404 }, { status: 200 }])
 * // -> { status: 404, body: { total: 2, failed: 1 } }
 * ```
 */
export function foldSet(answers: readonly Answer[]): BatchResult {
  const failed = answers.filter((answer) => answer.status < 200 || answer.status >= 300);
  const total = answers.length - failed.length;
  const first = failed[0];
  if (isUndefined(first)) return { status: 200, body: { total, failed: 0 } };
  const body = isPlainObject(first.body) ? first.body : {};
  return { status: first.status, body: { ...body, total, failed: failed.length } };
}

/**
 * Sends the approved proposals of `batch` in order and answers one result per proposal.
 * A declined proposal answers the decline the server expects; a write by set folds its rows into one.
 * Every answer is cut with `shapeResult` before it is kept.
 * A network failure stops the send and throws.
 */
export async function sendBatch(
  batch: TurnBatch,
  approvals: readonly Approval[],
  transport: SendTransport,
  options: SendOptions,
): Promise<BatchResult[]> {
  const total = approvals.reduce((sum, approval) => sum + countOf(approval), 0);
  let sent = 0;
  const progress = (): void => options.onProgress?.(sent, total);
  progress();
  const results: BatchResult[] = [];
  for (const [index, proposal] of batch.proposals.entries()) {
    const approval = approvals[index] ?? { send: false };
    if (!approval.send) {
      results.push(
        isUndefined(approval.note) ? { declined: true } : { declined: true, note: approval.note },
      );
      continue;
    }
    if (isUndefined(proposal.where)) {
      const answer = await sendRequest(transport, requestOf(proposal));
      results.push(shapeResult(answer.status, answer.body, options.limit));
      sent += 1;
      progress();
      continue;
    }
    const answers: Answer[] = [];
    for (const uuid of approval.UUIDs ?? []) {
      const answer = await sendRequest(transport, requestOf(proposal, uuid));
      answers.push(shapeResult(answer.status, answer.body, options.limit));
      sent += 1;
      progress();
    }
    results.push(foldSet(answers));
  }
  return results;
}

/**
 * Posts the results of one batch to `POST /ai/turns/[id]/results` and answers the next step's stream.
 * A batch is posted at most once: a second call for the same id answers `undefined` without a request.
 * That holds when the first post failed too, since the server may have taken it.
 */
export async function postResults(
  transport: SendTransport,
  turn: string,
  batch: string,
  results: readonly BatchResult[],
): Promise<Response | undefined> {
  if (posted.has(batch)) return undefined;
  posted.add(batch);
  const route = `POST ${fillRoute('/ai/turns/[id]/results', { id: turn })}`;
  const response = await fetchWithRetry(transport, route, {
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ batch, results }),
  });
  return response;
}

/**
 * How many requests an approval sends.
 */
function countOf(approval: Approval): number {
  if (!approval.send) return 0;
  return isUndefined(approval.UUIDs) ? 1 : approval.UUIDs.length;
}

/**
 * The body with its records cut so the whole serializes within `limit` UTF-8 bytes.
 * A body without a list of records stays as it is.
 */
function cutRecords(body: unknown, limit: number): unknown {
  const list = isArray(body)
    ? body
    : isPlainObject(body) && isArray(body.records)
      ? body.records
      : null;
  if (list === null) return body;
  const rebuild = (records: unknown[]): unknown =>
    isArray(body) ? records : { ...(body as Record<string, unknown>), records };
  let size = byteSize(rebuild([]));
  let kept = 0;
  for (const record of list) {
    const next = size + byteSize(record) + (kept === 0 ? 0 : 1);
    if (next > limit) break;
    size = next;
    kept += 1;
  }
  return kept === list.length ? body : rebuild(list.slice(0, kept));
}

/**
 * The UTF-8 bytes `value` serializes to.
 */
function byteSize(value: unknown): number {
  return encoder.encode(JSON.stringify(value)).length;
}
