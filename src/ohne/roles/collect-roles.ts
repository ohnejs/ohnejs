import type { OhneLayer } from '../project/resolve-ohne-layers.ts';
import type { RoleDefinition } from './define-role.ts';
import type { ScannedRole } from './scan-layer-roles.ts';

import { importDefault } from '../../utils/fs/index.ts';
import { isArray, isPlainObject, naturalCompare } from '../../utils/index.ts';
import { ohneError } from '../error/ohne-error.ts';
import { DIR_DEFAULTS } from '../layers/config.ts';
import { useLayers } from '../layers/use-layers.ts';
import { scanLayerRoles } from './scan-layer-roles.ts';

/**
 * One role with its imported definition, ready for codegen.
 */
export interface CollectedRole extends ScannedRole {
  /**
   * The definition the file default-exports.
   */
  role: RoleDefinition;
}

/**
 * Options for `collectRoles`.
 */
export interface CollectRolesOptions {
  /**
   * Role names to drop after the merge, matched exactly.
   *
   * @default
   * []
   */
  disable?: readonly string[];

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
 * Combines the roles of every layer into one deduplicated, imported list.
 *
 * Each layer is scanned in its own `dirs.roles` (default `'roles'`).
 * A closer layer's role replaces a further one's under the same name.
 * Names in `disable` are dropped after the merge.
 * Each survivor's definition is imported; a missing or malformed default export throws.
 * Results sort by name for deterministic output.
 */
export async function collectRoles(
  layers: readonly OhneLayer[],
  options: CollectRolesOptions = {},
): Promise<CollectedRole[]> {
  const { disable = [], fresh = false } = options;
  const configByPath = new Map(
    useLayers()
      .layers()
      .map((layer) => [layer.path, layer.input]),
  );
  const byName = new Map<string, ScannedRole>();
  for (const layer of layers) {
    const dir = configByPath.get(layer.dir)?.dirs?.roles ?? DIR_DEFAULTS.roles;
    for (const scanned of await scanLayerRoles(layer, dir)) byName.set(scanned.name, scanned);
  }

  const dropped = new Set(disable);
  const survivors = [...byName.values()]
    .filter((scanned) => !dropped.has(scanned.name))
    .sort((a, b) => naturalCompare(a.name, b.name));

  return Promise.all(
    survivors.map(async (scanned) => ({
      ...scanned,
      role: await definitionOf(scanned, fresh),
    })),
  );
}

/**
 * Imports one role's definition and rejects a file that does not default-export one.
 */
async function definitionOf(scanned: ScannedRole, fresh: boolean): Promise<RoleDefinition> {
  const definition = await importDefault<RoleDefinition>(scanned.file, { fresh });
  if (!isPlainObject(definition) || !isArray(definition.capabilities)) {
    throw ohneError({
      title: `Role \`${scanned.name}\` has no definition`,
      body: ['Default-export a `defineRole(...)` result from the file.'],
      path: scanned.file,
    });
  }
  return definition;
}
