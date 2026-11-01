import type { CollectedBlock } from '../blocks/collect-blocks.ts';
import type { BlockName } from '../blocks/known-blocks.ts';
import type { BlockMeta } from '../blocks/use-blocks.ts';
import type { CollectedCollection } from '../collections/collect-collections.ts';
import type { CollectionName } from '../collections/known-collections.ts';
import type { CollectionMeta } from '../collections/use-collections.ts';
import type { CollectedFieldType } from '../fields/collect-fields.ts';
import type { FieldTypeName } from '../fields/known-fields.ts';
import type { FieldTypeMeta } from '../fields/use-fields.ts';
import type { RoleName } from '../roles/known-roles.ts';

import { groupBy, swapRegistry } from '../../utils/index.ts';
import { collectBlocks } from '../blocks/collect-blocks.ts';
import { useBlocks } from '../blocks/use-blocks.ts';
import { collectCollections } from '../collections/collect-collections.ts';
import { useCollections } from '../collections/use-collections.ts';
import { collectFields } from '../fields/collect-fields.ts';
import { useFields } from '../fields/use-fields.ts';
import { stackedLayers } from '../layers/stacked-layers.ts';
import { useConfig } from '../layers/use-config.ts';
import { collectMessages } from '../messages/collect-messages.ts';
import { useMessages } from '../messages/use-messages.ts';
import { clearQueryMetadata } from '../query/metadata.ts';
import { collectRoles } from '../roles/collect-roles.ts';
import { useRoles } from '../roles/use-roles.ts';
import { emittableFieldTypes } from './read-shape.ts';

/**
 * Registry entries for each schema registry, as `schemaEntries` builds them.
 */
export interface SchemaEntries {
  collections: [string, CollectionMeta][];
  blocks: [string, BlockMeta][];
  fields: [string, FieldTypeMeta][];
}

/**
 * Options for `withStackRegistries`.
 */
export interface WithStackRegistriesOptions {
  /**
   * Re-import each definition fresh, past the module cache.
   * The dev supervisor sets it to pick up edits in its own long-lived process.
   *
   * @default
   * false
   */
  fresh?: boolean;
}

/**
 * Runs `run` with the role, message, collection, block, and field-type registries holding the stack's own.
 *
 * Codegen runs before any generated registration is imported, so the registries are otherwise empty.
 * Each is filled from the stacked layers as the generated registrations fill it, `disable` lists applied.
 * Every registry gets its previous entries back once `run` settles, and the query metadata memo is dropped.
 * Layers come from the registered stack, so `loadLayers` must have run first.
 *
 * @example
 * ```ts
 * await withStackRegistries(() => useRoles().keys()) // -> ['admin', 'editor']
 * useRoles().keys()                                  // -> []
 * ```
 */
export async function withStackRegistries<T>(
  run: () => T | Promise<T>,
  options: WithStackRegistriesOptions = {},
): Promise<T> {
  const { fresh = false } = options;
  const { disable } = useConfig();
  const [roles, messages, collections, blocks, fields] = await Promise.all([
    collectRoles(stackedLayers(), { disable: disable.roles, fresh }),
    collectMessages(stackedLayers(), { disable: disable.messages }),
    collectCollections(stackedLayers(), { disable: disable.collections, fresh }),
    collectBlocks(stackedLayers(), { disable: disable.blocks, fresh }),
    collectFields(stackedLayers(), { disable: disable.fields, fresh }),
  ]);
  const catalogs = Object.entries(groupBy(messages, (message) => message.language));
  const schema = schemaEntries(collections, blocks, fields, disable.fields);
  const restores = [
    swapRegistry(
      useRoles(),
      roles.map(({ name, role }) => [name, { name: name as RoleName, role }]),
    ),
    swapRegistry(
      useMessages(),
      catalogs.map(([language, entries = []]) => [
        language,
        Object.fromEntries(entries.map((entry) => [entry.key, entry.template])),
      ]),
    ),
    swapRegistry(useCollections(), schema.collections),
    swapRegistry(useBlocks(), schema.blocks),
    swapRegistry(useFields(), schema.fields),
  ];
  clearQueryMetadata();
  try {
    return await run();
  } finally {
    for (const restore of restores) restore();
    clearQueryMetadata();
  }
}

/**
 * The collection, block, and field-type registry entries of the collected definitions.
 */
export function schemaEntries(
  collections: readonly CollectedCollection[],
  blocks: readonly CollectedBlock[],
  fields: readonly CollectedFieldType[],
  disabledFields: readonly string[],
): SchemaEntries {
  return {
    collections: collections.map(({ name, collection, file }) => [
      name,
      { name: name as CollectionName, collection, file },
    ]),
    blocks: blocks.map(({ name, block, file }) => [name, { name: name as BlockName, block, file }]),
    fields: [...emittableFieldTypes(fields, disabledFields)].map(([name, { fieldType }]) => [
      name,
      { name: name as FieldTypeName, fieldType },
    ]),
  };
}
