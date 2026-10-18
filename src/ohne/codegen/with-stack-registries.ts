import type { BlockName } from '../blocks/known-blocks.ts';
import type { CollectionName } from '../collections/known-collections.ts';
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
    swapRegistry(
      useCollections(),
      collections.map(({ name, collection, file }) => [
        name,
        { name: name as CollectionName, collection, file },
      ]),
    ),
    swapRegistry(
      useBlocks(),
      blocks.map(({ name, block, file }) => [name, { name: name as BlockName, block, file }]),
    ),
    swapRegistry(
      useFields(),
      [...emittableFieldTypes(fields, disable.fields)].map(([name, { fieldType }]) => [
        name,
        { name, fieldType },
      ]),
    ),
  ];
  clearQueryMetadata();
  try {
    return await run();
  } finally {
    for (const restore of restores) restore();
    clearQueryMetadata();
  }
}
