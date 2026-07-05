import { physicalName } from './_physical.ts';

/**
 * The cluster-lock table backing the base `acquireLock` and `releaseLock`.
 */
export const OHNE_LOCKS = 'ohne_locks';

/**
 * Prefix of the aside name a table rebuild renames the old table to while it swaps shapes.
 */
export const OHNE_REBUILD_PREFIX = 'ohne_rebuild_';

/**
 * The one-row table holding the schema snapshot.
 */
export const OHNE_SCHEMA = 'ohne_schema';

/**
 * The table of a collection: the collection name verbatim, capped at the physical boundary.
 *
 * @example
 * ```ts
 * collectionTableName('APIKeys') // -> 'APIKeys'
 * ```
 */
export function collectionTableName(collection: string): string {
  return physicalName(collection);
}

/**
 * The table of a derived structure - junction, object, repeater, or blocks wrapper.
 * The owner and the field path join with a single `_`; deeper fields compose nested derivations.
 *
 * @example
 * ```ts
 * derivedTableName('Posts', 'authors')           // -> 'Posts_authors'
 * derivedTableName('Posts', 'sections', 'items') // -> 'Posts_sections_items'
 * ```
 */
export function derivedTableName(owner: string, field: string, ...nested: string[]): string {
  return physicalName([owner, field, ...nested].join('_'));
}

/**
 * The translations companion of a collection table.
 * The `__` join marks a framework name, unreachable from user identifiers.
 *
 * @example
 * ```ts
 * companionTableName('Posts') // -> 'Posts__translations'
 * ```
 */
export function companionTableName(owner: string): string {
  return physicalName(`${owner}__translations`);
}

/**
 * The shared per-type data table of a block, the block name's casing kept verbatim.
 *
 * @example
 * ```ts
 * blockTableName('PricingCard') // -> 'block_PricingCard'
 * ```
 */
export function blockTableName(block: string): string {
  return physicalName(`block_${block}`);
}
