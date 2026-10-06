import type { DashboardCollection, DashboardMeta } from '../runtime/meta-types.ts';

import { isEmpty } from '../../utils/is/is-empty.ts';
import { isString } from '../../utils/is/is-string.ts';
import { isUndefined } from '../../utils/is/is-undefined.ts';
import { effect } from '../../utils/reactive/effect.ts';
import { ref, type Ref } from '../../utils/reactive/ref.ts';
import { untracked } from '../../utils/reactive/untracked.ts';
import { renderLabel } from '../../utils/template/render-label.ts';
import { shortUUID } from '../../utils/uuid/short-uuid.ts';
import { api } from '../runtime/api.ts';
import { dashboardMeta } from '../runtime/meta.ts';
import { labelBatchKey, labelKey, labelScope } from './_label-keys.ts';

const CAPACITY = 2000;

/**
 * One batch of unresolved records: a target read at one locale.
 */
interface Batch {
  target: string;
  locale: string | undefined;
  uuids: Set<string>;
}

const entries = new Map<string, Ref<string | undefined>>();
const pending = new Map<string, Batch>();
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
 * `locale` is the content locale the label reads in; omitted, it reads the default locale.
 */
export function labelOf(target: string, uuid: string, locale?: string): string | undefined {
  const scope = scopeOf(target, locale);
  const entry = entryOf(labelKey(target, uuid, scope));
  const value = entry.value;
  if (isUndefined(value)) enqueue(target, uuid, scope);
  return value;
}

/**
 * The label already resolved for one record, `undefined` while none is; it never fetches.
 * The read is reactive, so the binding lands on the label the moment a seed writes one.
 * A surface reading the record itself binds this and seeds from its own row, sparing a second query.
 */
export function knownLabel(target: string, uuid: string, locale?: string): string | undefined {
  return entryOf(labelKey(target, uuid, scopeOf(target, locale))).value;
}

/**
 * Requests labels ahead of display, so they resolve before their bindings first read.
 * Requests dedupe, batch per target and locale, and flush on a microtask as one query per batch.
 */
export function wantLabels(target: string, uuids: readonly string[], locale?: string): void {
  sync();
  const scope = scopeOf(target, locale);
  for (const uuid of uuids) {
    const known = untracked(() => entries.get(labelKey(target, uuid, scope))?.value);
    if (isUndefined(known)) enqueue(target, uuid, scope);
  }
}

/**
 * Seeds a label without a fetch: picker results, loaded pages, answered writes.
 * `locale` is the content locale the label was read in, so it never stands in for another locale's.
 * A pending request for the `uuid` is dropped; a seeded label re-resolves every binding reading it.
 */
export function seedLabel(target: string, uuid: string, label: string, locale?: string): void {
  sync();
  const scope = scopeOf(target, locale);
  pending.get(labelBatchKey(target, scope))?.uuids.delete(uuid);
  write(labelKey(target, uuid, scope), label);
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
  return renderLabel(row, collection.labelFields, collection.labelTemplate);
}

/**
 * The scope `target`'s labels at `locale` cache under, against the current discovery data.
 */
function scopeOf(target: string, locale: string | undefined): string | undefined {
  return labelScope(untracked(dashboardMeta), target, locale);
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
    const split = key.lastIndexOf(':');
    if (pending.get(key.slice(0, split))?.uuids.has(key.slice(split + 1)) === true) continue;
    entries.delete(key);
  }
}

/**
 * Adds `uuid` to its batch and schedules a flush, unless a request already carries it.
 */
function enqueue(target: string, uuid: string, scope: string | undefined): void {
  if (inFlight.has(labelKey(target, uuid, scope))) return;
  const key = labelBatchKey(target, scope);
  const batch = pending.get(key);
  if (isUndefined(batch)) pending.set(key, { target, locale: scope, uuids: new Set([uuid]) });
  else batch.uuids.add(uuid);
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
  const batches = [...pending.values()];
  pending.clear();
  for (const batch of batches) {
    if (batch.uuids.size > 0) void flushBatch(batch.target, batch.locale, [...batch.uuids]);
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
 * Resolves one batch with a single query at its locale.
 * A `uuid` the response omits settles on the placeholder.
 * A failed request leaves its refs unresolved, so a later read re-enqueues the batch.
 */
async function flushBatch(
  target: string,
  locale: string | undefined,
  uuids: readonly string[],
): Promise<void> {
  const collection = readableCollection(target);
  if (isUndefined(collection) || isEmpty(collection.labelFields)) {
    for (const uuid of uuids) write(labelKey(target, uuid, locale), fallbackLabel(uuid));
    return;
  }
  const source = basis;
  const names = collection.labelFields;
  const keys = uuids.map((uuid) => labelKey(target, uuid, locale));
  for (const key of keys) inFlight.add(key);
  try {
    const response = await api(`POST /collections/${collection.segment}/query`, {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        select: ['UUID', ...names],
        where: { UUID: { in: uuids } },
        limit: uuids.length,
        ...(isUndefined(locale) ? {} : { locale }),
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
      write(labelKey(target, uuid, locale), label !== '' ? label : fallbackLabel(uuid));
    }
    for (const uuid of uuids) {
      if (answered.has(uuid)) continue;
      const entry = entryOf(labelKey(target, uuid, locale));
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
 * Stores `label` under `key`, waking every binding that reads it.
 */
function write(key: string, label: string): void {
  entryOf(key).value = label;
}
