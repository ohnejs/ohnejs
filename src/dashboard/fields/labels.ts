import type { DashboardCollection } from '../runtime/meta-types.ts';

import { isString } from '../../utils/is/is-string.ts';
import { isUndefined } from '../../utils/is/is-undefined.ts';
import { effect } from '../../utils/reactive/effect.ts';
import { ref, type Ref } from '../../utils/reactive/ref.ts';
import { untracked } from '../../utils/reactive/untracked.ts';
import { api } from '../runtime/api.ts';
import { dashboardMeta } from '../runtime/meta.ts';
import { labelFieldOf } from './_search.ts';

const CAPACITY = 2000;

const entries = new Map<string, Ref<string | undefined>>();
const pending = new Map<string, Set<string>>();
const inFlight = new Set<string>();
let scheduled = false;
let awaitingMeta = false;

/**
 * The resolved label for one record of the target collection, `undefined` while unresolved.
 * The read is reactive, and an unknown `uuid` schedules a batched fetch, so a binding resolves in place.
 * A record without a label value, a deleted record, and an unresolvable target all settle on the `uuid`.
 * A binding therefore always lands on text and never refetches.
 * `target` is the collection name, as `DashboardField.target` carries it.
 */
export function labelOf(target: string, uuid: string): string | undefined {
  const entry = entryOf(`${target}:${uuid}`);
  const value = entry.value;
  if (isUndefined(value)) enqueue(target, uuid);
  return value;
}

/**
 * Requests labels ahead of display, so they resolve before their bindings first read.
 * Requests dedupe, batch per target, and flush on a microtask as one query per target.
 */
export function wantLabels(target: string, uuids: readonly string[]): void {
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
  pending.get(target)?.delete(uuid);
  write(target, uuid, label);
}

/**
 * The entry for `key`, created unresolved when missing; every hit refreshes its recency.
 */
function entryOf(key: string): Ref<string | undefined> {
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

function enqueue(target: string, uuid: string): void {
  if (inFlight.has(`${target}:${uuid}`)) return;
  const bucket = pending.get(target);
  if (isUndefined(bucket)) pending.set(target, new Set([uuid]));
  else bucket.add(uuid);
  schedule();
}

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
 * Resolves one target's batch with a single query; a `uuid` the response omits settles on itself.
 * A failed request leaves its refs unresolved, so a later read re-enqueues the batch.
 */
async function flushTarget(target: string, uuids: readonly string[]): Promise<void> {
  const collection = readableCollection(target);
  const label = isUndefined(collection) ? undefined : labelFieldOf(collection);
  if (isUndefined(collection) || isUndefined(label)) {
    for (const uuid of uuids) write(target, uuid, uuid);
    return;
  }
  const keys = uuids.map((uuid) => `${target}:${uuid}`);
  for (const key of keys) inFlight.add(key);
  try {
    const response = await api(`POST /collections/${collection.segment}/query`, {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        select: ['UUID', label.name],
        where: { UUID: { in: uuids } },
        limit: uuids.length,
      }),
    });
    if (!response.ok) return;
    const rows = (await response.json()) as Record<string, unknown>[];
    const answered = new Set<string>();
    for (const row of rows) {
      const uuid = row.UUID;
      if (!isString(uuid)) continue;
      answered.add(uuid);
      const value = row[label.name];
      write(target, uuid, isString(value) && value !== '' ? value : uuid);
    }
    for (const uuid of uuids) {
      if (answered.has(uuid)) continue;
      const entry = entryOf(`${target}:${uuid}`);
      if (isUndefined(entry.value)) entry.value = uuid;
    }
  } catch {
  } finally {
    for (const key of keys) inFlight.delete(key);
  }
}

/**
 * The collection named `name`, when the discovery read lists it as readable for the user.
 * `targetOf` in `_search.ts` resolves from a field; the cache holds only the name, so it looks up itself.
 */
function readableCollection(name: string): DashboardCollection | undefined {
  const collection = dashboardMeta()?.collections.find((entry) => entry.name === name);
  if (isUndefined(collection) || collection.operations.read?.allowed !== true) return undefined;
  return collection;
}

function write(target: string, uuid: string, label: string): void {
  entryOf(`${target}:${uuid}`).value = label;
}
