import type { AnyCollectionDefinition } from './define-collection.ts';
import type { CollectionName } from './known-collections.ts';

import { createRegistry, type Registry } from '../../utils/index.ts';

/**
 * One registered collection: its name and its definition.
 */
export interface CollectionMeta {
  /**
   * The collection name, taken from its file.
   */
  name: CollectionName;

  /**
   * The collection definition, widened so any concrete `defineCollection` result fits.
   */
  collection: AnyCollectionDefinition;
}

const registry: Registry<CollectionMeta> = createRegistry<CollectionMeta>();

/**
 * Returns the process-wide collection registry, keyed by collection name.
 *
 * Core ships no collections; codegen registers every layer's own.
 * A name that already exists is overridden, so a collection from a closer layer wins.
 *
 * @example
 * ```ts
 * useCollections().keys() // -> ['Posts', 'Authors']
 * ```
 */
export function useCollections(): Registry<CollectionMeta> {
  return registry;
}
