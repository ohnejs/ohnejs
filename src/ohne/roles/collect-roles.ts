import type { OhneLayer } from '../project/resolve-ohne-layers.ts';
import type { RoleDefinition } from './define-role.ts';

import { isArray, isPlainObject } from '../../utils/index.ts';
import {
  collectLayerFiles,
  type CollectedFile,
  type CollectLayerFilesOptions,
} from '../layers/collect-layer-files.ts';

/**
 * One role with its imported definition under `role`, ready for codegen.
 */
export type CollectedRole = CollectedFile<'role', RoleDefinition>;

/**
 * Combines the roles of every layer into one deduplicated, imported list.
 *
 * Each layer is scanned in its own `dirs.roles` (default `'roles'`).
 * A closer layer's role replaces a further one's under the same name.
 * Names in `disable` are dropped after the merge.
 * Each survivor's definition is imported; a missing or malformed default export throws.
 * Results sort by name for deterministic output.
 */
export function collectRoles(
  layers: readonly OhneLayer[],
  options: CollectLayerFilesOptions = {},
): Promise<CollectedRole[]> {
  return collectLayerFiles('role', layers, isRoleDefinition, options);
}

/**
 * Whether a default export has the shape of a `defineRole` result.
 */
function isRoleDefinition(definition: unknown): definition is RoleDefinition {
  return isPlainObject(definition) && isArray(definition.capabilities);
}
