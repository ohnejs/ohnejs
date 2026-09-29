import { isUndefined } from '../../../utils/index.ts';
import { physicalName } from './_physical.ts';

/**
 * The owner a derived table's names compose from: a collection, or a block's per-type root.
 * Exactly one of the two is set.
 */
export interface DerivedOwner {
  /**
   * The owning collection's logical name; absent when a block owns the family.
   */
  collection?: string;

  /**
   * The owning block's name; absent when a collection owns the family.
   */
  block?: string;
}

/**
 * A derived table's origin as the naming builders read it: the owner plus the field path down to it.
 */
interface DerivedOwnerPath extends DerivedOwner {
  path: readonly [string, ...string[]];
}

/**
 * The cluster-lock table backing the base `acquireLock` and `releaseLock`.
 */
export const OHNE_LOCKS = 'ohne_locks';

/**
 * The rate-limit table backing the base `takeRateLimit`: one row per counted key.
 */
export const OHNE_RATE_LIMITS = 'ohne_rate_limits';

/**
 * The migration-state table: one row per migration, stamped `applied` or `skipped`.
 */
export const OHNE_MIGRATIONS = 'ohne_migrations';

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
  return physicalName(blockRootName(block));
}

/**
 * The logical root name of a block's table family, before the physical cap.
 * Derived tables under a block compose from it through `derivedTableName`.
 *
 * @example
 * ```ts
 * blockRootName('Hero') // -> 'block_Hero'
 * ```
 */
export function blockRootName(block: string): string {
  return `block_${block}`;
}

/**
 * The logical root name a derived table's family composes from.
 * The owning collection's name, or the `block_<Name>` root when a block owns the family.
 *
 * @example
 * ```ts
 * derivedRootName({ collection: 'Posts' }) // -> 'Posts'
 * derivedRootName({ block: 'Hero' })       // -> 'block_Hero'
 * ```
 */
export function derivedRootName(owner: DerivedOwner): string {
  return isUndefined(owner.collection) ? blockRootName(owner.block as string) : owner.collection;
}

/**
 * The root table of an owner: the collection's own table, or the block's per-type table.
 *
 * @example
 * ```ts
 * ownerTableName({ collection: 'Posts' }) // -> 'Posts'
 * ownerTableName({ block: 'Hero' })       // -> 'block_Hero'
 * ```
 */
export function ownerTableName(owner: DerivedOwner): string {
  return isUndefined(owner.collection)
    ? blockTableName(owner.block as string)
    : collectionTableName(owner.collection);
}

/**
 * The physical table a derived table hangs off: its owner's root table, or the next composite up.
 *
 * @example
 * ```ts
 * derivedParentName({ collection: 'Posts', path: ['sections'] })
 * // -> 'Posts'
 *
 * derivedParentName({ collection: 'Posts', path: ['sections', 'items'] })
 * // -> 'Posts_sections'
 *
 * derivedParentName({ block: 'Hero', path: ['links'] })
 * // -> 'block_Hero'
 * ```
 */
export function derivedParentName(origin: DerivedOwnerPath): string {
  const root = derivedRootName(origin);
  const [first, ...rest] = origin.path;
  if (rest.length === 0) return physicalName(root);
  return derivedTableName(root, first, ...rest.slice(0, -1));
}
