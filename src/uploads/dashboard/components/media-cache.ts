import { isNull, isNumber, isUndefined, type Ref, ref, untracked } from 'ohnejs/utils';

import type { UploadRecord } from '../../uploads/types.ts';

/**
 * Reads the `Uploads` records with the given `UUID`s in one request.
 * Resolves the records the server answered, in any order; `undefined` says the request failed.
 * A `UUID` the answer omits is taken as deleted.
 */
export type MediaCacheLoader = (
  uuids: readonly string[],
) => Promise<readonly UploadRecord[] | undefined>;

/**
 * Options for `createMediaCache`.
 */
export interface MediaCacheOptions {
  /**
   * How many records the cache keeps before dropping the least recently read.
   *
   * @default
   * 500
   */
  capacity?: number;

  /**
   * The clock a record's `expires` is checked against, in epoch milliseconds.
   *
   * @default
   * Date.now
   */
  now?: () => number;
}

/**
 * A reactive cache of `Uploads` records by `UUID`, fetched in microtask batches.
 * An entry is `undefined` while unresolved, `null` for a record the server does not have.
 */
export interface MediaCache {
  /**
   * The record for `uuid`, reactive.
   * An unknown `uuid` schedules a batched fetch, so a binding resolves in place.
   * A record whose `expires` has passed schedules one too and stays in place until the answer lands.
   */
  get(uuid: string): UploadRecord | null | undefined;

  /**
   * Resolves the records for `uuids` in the given order, fetching only the unseen and the expired ones.
   * An entry stays `undefined` when its request failed.
   * Never subscribes a reactive caller; a binding reads through `get`.
   */
  load(uuids: readonly string[]): Promise<(UploadRecord | null | undefined)[]>;

  /**
   * Stores a record without a fetch: a loaded page, a pick, an answered write.
   * A pending request for it is dropped; every binding reading it re-resolves.
   */
  seed(record: UploadRecord): void;

  /**
   * Re-fetches every cached record; each keeps its value until the answer lands.
   */
  refresh(): void;
}

interface Batch {
  promise: Promise<void>;
  resolve(): void;
}

const DEFAULT_CAPACITY = 500;

/**
 * Creates a `MediaCache` over `load`.
 * Reads within one microtask coalesce into one request; a `UUID` already in flight is never asked twice.
 * A failed request leaves its entries unresolved, so a later read re-enqueues them.
 * An expired record is re-asked once per `expires` value, so an already expired answer never loops.
 *
 * @example
 * ```ts
 * const cache = createMediaCache(fetchUploads)
 *
 * cache.get(a)                 // -> undefined, schedules the fetch
 * cache.get(b)                 // -> undefined, joins the same request
 * await cache.load([a, b])     // -> [recordA, recordB]
 * cache.get(a)                 // -> recordA
 * ```
 */
export function createMediaCache(
  load: MediaCacheLoader,
  options: MediaCacheOptions = {},
): MediaCache {
  const capacity = options.capacity ?? DEFAULT_CAPACITY;
  const now = options.now ?? Date.now;
  const entries = new Map<string, Ref<UploadRecord | null | undefined>>();
  const pending = new Set<string>();
  const inFlight = new Map<string, Promise<void>>();
  const renewed = new Map<string, number>();
  let batch: Batch | undefined;

  const entryOf = (uuid: string): Ref<UploadRecord | null | undefined> => {
    const existing = entries.get(uuid);
    if (!isUndefined(existing)) {
      entries.delete(uuid);
      entries.set(uuid, existing);
      return existing;
    }
    const created = ref<UploadRecord | null | undefined>(undefined);
    entries.set(uuid, created);
    evict();
    return created;
  };

  const evict = (): void => {
    for (const uuid of entries.keys()) {
      if (entries.size <= capacity) return;
      if (!pending.has(uuid) && !inFlight.has(uuid)) {
        entries.delete(uuid);
        renewed.delete(uuid);
      }
    }
  };

  const stale = (uuid: string, value: UploadRecord | null | undefined): boolean => {
    if (isUndefined(value)) return true;
    if (isNull(value) || !isNumber(value.expires) || value.expires > now()) return false;
    if (renewed.get(uuid) === value.expires) return false;
    renewed.set(uuid, value.expires);
    return true;
  };

  const flush = async (): Promise<void> => {
    const current = batch as Batch;
    batch = undefined;
    const uuids = [...pending];
    pending.clear();
    if (uuids.length === 0) {
      current.resolve();
      return;
    }
    for (const uuid of uuids) inFlight.set(uuid, current.promise);
    try {
      const rows = await load(uuids);
      if (!isUndefined(rows)) {
        const answered = new Set<string>();
        for (const row of rows) {
          answered.add(row.UUID);
          entryOf(row.UUID).value = row;
        }
        for (const uuid of uuids) {
          if (!answered.has(uuid)) entryOf(uuid).value = null;
        }
      } else {
        for (const uuid of uuids) renewed.delete(uuid);
      }
    } catch {
      for (const uuid of uuids) renewed.delete(uuid);
    } finally {
      for (const uuid of uuids) inFlight.delete(uuid);
      current.resolve();
    }
  };

  const schedule = (): Promise<void> => {
    if (!isUndefined(batch)) return batch.promise;
    let resolve = (): void => {};
    const promise = new Promise<void>((done) => {
      resolve = done;
    });
    batch = { promise, resolve };
    queueMicrotask(() => void flush());
    return promise;
  };

  const enqueue = (uuid: string): Promise<void> => {
    const flying = inFlight.get(uuid);
    if (!isUndefined(flying)) return flying;
    pending.add(uuid);
    return schedule();
  };

  return {
    get(uuid) {
      const value = entryOf(uuid).value;
      if (stale(uuid, value)) void enqueue(uuid);
      return value;
    },
    async load(uuids) {
      const waits = untracked(() =>
        uuids.filter((uuid) => stale(uuid, entryOf(uuid).value)).map((uuid) => enqueue(uuid)),
      );
      await Promise.all(waits);
      return uuids.map((uuid) => entryOf(uuid).value);
    },
    seed(record) {
      pending.delete(record.UUID);
      entryOf(record.UUID).value = record;
    },
    refresh() {
      for (const uuid of entries.keys()) void enqueue(uuid);
    },
  };
}
