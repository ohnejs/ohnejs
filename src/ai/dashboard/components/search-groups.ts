import { getOrSet, isArray, isInteger, isPlainObject, isString, isUndefined } from 'ohnejs/utils';

/**
 * One record a search found, as a live or a replayed answer names it.
 */
export interface SearchGroupHit {
  /**
   * The record's `UUID`.
   */
  UUID: string;

  /**
   * The record's label, which only a live answer carries.
   */
  label?: string;
}

/**
 * The records a search found in one collection, directly or through one target collection.
 */
export interface SearchGroup {
  /**
   * The collection the records belong to.
   */
  collection: string;

  /**
   * The collection a word matched in, for records found through a link; absent for direct hits.
   */
  via?: string;

  /**
   * The records the answer names, in its order.
   */
  hits: SearchGroupHit[];

  /**
   * How many records the group holds: a replay's kept count, or the live answer's whole group.
   */
  total: number;
}

/**
 * The groups of a `POST /search` answer, live or replayed: direct hits by collection, related ones by target.
 * Groups keep the order their first hit has in the answer, so the direct ones lead.
 * A replayed answer keeps only its first ids, so its `found` and `related` counts give each total.
 * A hit without a `collection` or a `UUID` is skipped.
 *
 * @example
 * ```ts
 * searchGroups({ results: [{ collection: 'People', UUID: A, via: { collection: 'Uploads' } }] })
 * // -> [{ collection: 'People', via: 'Uploads', hits: [{ UUID: A }], total: 1 }]
 *
 * searchGroups({ results: [{ collection: 'People', UUID: A }], found: { People: 20 } })
 * // -> [{ collection: 'People', hits: [{ UUID: A }], total: 20 }]
 * ```
 */
export function searchGroups(body: unknown): SearchGroup[] {
  if (!isPlainObject(body) || !isArray(body.results)) return [];
  const groups = new Map<string, SearchGroup>();
  for (const { collection, UUID, label, via } of body.results.filter(isPlainObject)) {
    if (!isString(collection) || !isString(UUID)) continue;
    const target = isPlainObject(via) && isString(via.collection) ? via.collection : undefined;
    const group = getOrSet(groups, `${collection}\n${target ?? ''}`, () =>
      isUndefined(target)
        ? { collection, hits: [], total: 0 }
        : { collection, via: target, hits: [], total: 0 },
    );
    group.hits.push(isString(label) ? { UUID, label } : { UUID });
  }
  for (const group of groups.values()) {
    const { collection, via } = group;
    const counts = isUndefined(via) ? body.found : body.related;
    const kept = isPlainObject(counts) ? counts[collection] : undefined;
    const count = isUndefined(via) ? kept : isPlainObject(kept) ? kept[via] : undefined;
    group.total = isInteger(count) ? count : group.hits.length;
  }
  return [...groups.values()];
}
