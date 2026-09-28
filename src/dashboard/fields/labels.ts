import type { DashboardCollection, DashboardMeta } from '../runtime/meta-types.ts';

import { isEmpty } from '../../utils/is/is-empty.ts';
import { isString } from '../../utils/is/is-string.ts';
import { isUndefined } from '../../utils/is/is-undefined.ts';
import { effect } from '../../utils/reactive/effect.ts';
import { ref, type Ref } from '../../utils/reactive/ref.ts';
import { untracked } from '../../utils/reactive/untracked.ts';
import { renderTemplate } from '../../utils/template/render-template.ts';
import { shortUUID } from '../../utils/uuid/short-uuid.ts';
import { api } from '../runtime/api.ts';
import { dashboardMeta } from '../runtime/meta.ts';

const CAPACITY = 2000;

const entries = new Map<string, Ref<string | undefined>>();
const pending = new Map<string, Set<string>>();
const inFlight = new Set<string>();
let scheduled = false;
let awaitingMeta = false;
let basis: DashboardMeta | undefined;

/**
 * The resolved label for one record of the target collection, `undefined` while unresolved.
 * The read is reactive, and an unknown `uuid` schedules a batched fetch, so a binding resolves in place.
 * A record without label text, a deleted record, and an unresolvable target all settle on `fallbackLabel`.
 * A failed request leaves the label `undefined` until a later read retries.
 * `target` is the collection name, as `DashboardField.target` carries it.
 */
export function labelOf(target: string, uuid: string): string | undefined {
  const entry = entryOf(`${target}:${uuid}`);
  const value = entry.value;
  if (isUndefined(value)) enqueue(target, uuid);
  return value;
}

/**
 * The label already resolved for one record, `undefined` while none is; it never fetches.
 * The read is reactive, so the binding lands on the label the moment a seed writes one.
 * A surface reading the record itself binds this and seeds from its own row, sparing a second query.
 */
export function knownLabel(target: string, uuid: string): string | undefined {
  return entryOf(`${target}:${uuid}`).value;
}

/**
 * Requests labels ahead of display, so they resolve before their bindings first read.
 * Requests dedupe, batch per target, and flush on a microtask as one query per target.
 */
export function wantLabels(target: string, uuids: readonly string[]): void {
  sync();
  for (const uuid of uuids) {
    const known = untracked(() => entries.get(`${target}:${uuid}`)?.value);
    if (isUndefined(known)) enqueue(target, uuid);
  }
}

/**
 * Seeds a label without a fetch: picker results, loaded pages, answered writes.
 * A pending request for the `uuid` is dropped; a seeded label re-resolves every binding reading it.
 */
export function seedLabel(target: string, uuid: string, label: string): void {
  sync();
  pending.get(target)?.delete(uuid);
  write(target, uuid, label);
}

/**
 * The placeholder naming a record without label text: `#` plus the `UUID`'s last eight characters.
 */
export function fallbackLabel(uuid: string): string {
  return `#${shortUUID(uuid)}`;
}

/**
 * The label a row's values give a record of `collection`; `''` when no label field carries text.
 * A declared `labelTemplate` renders with its literals, a literal dropping beside an empty field.
 * Without one, the `labelFields` values join with single spaces in order, skipping empty ones.
 */
export function joinLabel(row: Record<string, unknown>, collection: DashboardCollection): string {
  if (!isUndefined(collection.labelTemplate)) return renderTemplate(collection.labelTemplate, row);
  return collection.labelFields
    .map((name) => row[name])
    .filter((value): value is string => isString(value) && value !== '')
    .join(' ');
}

/**
 * The entry for `key`, created unresolved when missing; every hit refreshes its recency.
 */
function entryOf(key: string): Ref<string | undefined> {
  sync();
  const existing = entries.get(key);
  if (!isUndefined(existing)) {
    entries.delete(key);
    entries.set(key, existing);
    return existing;
  }
  const created = ref<string | undefined>(undefined);
  entries.set(key, created);
  evict();
  return created;
}

/**
 * Drops the least recently used entries over capacity, never one a request still owes an answer.
 */
function evict(): void {
  if (entries.size <= CAPACITY) return;
  for (const key of entries.keys()) {
    if (entries.size <= CAPACITY) return;
    if (inFlight.has(key)) continue;
    const split = key.indexOf(':');
    if (pending.get(key.slice(0, split))?.has(key.slice(split + 1)) === true) continue;
    entries.delete(key);
  }
}

/**
 * Adds `uuid` to its target's pending batch and schedules a flush, unless a request already carries it.
 */
function enqueue(target: string, uuid: string): void {
  if (inFlight.has(`${target}:${uuid}`)) return;
  const bucket = pending.get(target);
  if (isUndefined(bucket)) pending.set(target, new Set([uuid]));
  else bucket.add(uuid);
  schedule();
}

/**
 * Queues one `flush` on a microtask, however many requests arrive before it runs.
 */
function schedule(): void {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(flush);
}

/**
 * Sends every pending bucket; before the discovery data answers, it waits and flushes on arrival.
 */
function flush(): void {
  scheduled = false;
  sync();
  if (pending.size === 0) return;
  if (isUndefined(dashboardMeta())) {
    watchMeta();
    return;
  }
  const buckets = [...pending];
  pending.clear();
  for (const [target, uuids] of buckets) {
    if (uuids.size > 0) void flushTarget(target, [...uuids]);
  }
}

/**
 * Arms a one-time effect that re-schedules the flush when the discovery data arrives.
 */
function watchMeta(): void {
  if (awaitingMeta) return;
  awaitingMeta = true;
  const stop = effect(() => {
    if (isUndefined(dashboardMeta())) return;
    awaitingMeta = false;
    queueMicrotask(stop);
    schedule();
  });
}

/**
 * Resolves one target's batch with a single query; a `uuid` the response omits settles on the placeholder.
 * A failed request leaves its refs unresolved, so a later read re-enqueues the batch.
 */
async function flushTarget(target: string, uuids: readonly string[]): Promise<void> {
  const collection = readableCollection(target);
  if (isUndefined(collection) || isEmpty(collection.labelFields)) {
    for (const uuid of uuids) write(target, uuid, fallbackLabel(uuid));
    return;
  }
  const source = basis;
  const names = collection.labelFields;
  const keys = uuids.map((uuid) => `${target}:${uuid}`);
  for (const key of keys) inFlight.add(key);
  try {
    const response = await api(`POST /collections/${collection.segment}/query`, {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        select: ['UUID', ...names],
        where: { UUID: { in: uuids } },
        limit: uuids.length,
      }),
    });
    if (!response.ok) return;
    const rows = (await response.json()) as Record<string, unknown>[];
    sync();
    if (basis !== source) return;
    const answered = new Set<string>();
    for (const row of rows) {
      const uuid = row.UUID;
      if (!isString(uuid)) continue;
      answered.add(uuid);
      const label = joinLabel(row, collection);
      write(target, uuid, label !== '' ? label : fallbackLabel(uuid));
    }
    for (const uuid of uuids) {
      if (answered.has(uuid)) continue;
      const entry = entryOf(`${target}:${uuid}`);
      if (isUndefined(entry.value)) entry.value = fallbackLabel(uuid);
    }
  } catch {
  } finally {
    if (basis === source) for (const key of keys) inFlight.delete(key);
  }
}

/**
 * The collection named `name`, when the discovery read lists it as readable for the user.
 */
function readableCollection(name: string): DashboardCollection | undefined {
  const collection = dashboardMeta()?.collections.find((entry) => entry.name === name);
  if (isUndefined(collection) || collection.operations.read?.allowed !== true) return undefined;
  return collection;
}

/**
 * Empties the cache once the discovery data it resolved under is gone, so labels follow the current user.
 * Data arriving into an empty store adopts the cache as is, since its entries were made while it loaded.
 */
function sync(): void {
  const current = untracked(dashboardMeta);
  if (current === basis) return;
  if (!isUndefined(basis)) {
    entries.clear();
    pending.clear();
    inFlight.clear();
  }
  basis = current;
}

/**
 * Stores `label` for the record, waking every binding that reads it.
 */
function write(target: string, uuid: string, label: string): void {
  entryOf(`${target}:${uuid}`).value = label;
}
