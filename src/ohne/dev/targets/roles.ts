import { generateRoles } from '../../codegen/generate-roles.ts';
import { stackedLayers } from '../../layers/stacked-layers.ts';
import { collectRoles } from '../../roles/collect-roles.ts';
import { createSetTarget, type SetTarget } from './set-target.ts';

/**
 * The role table target.
 * Its closure is every layer's `dirs.roles`; it regenerates `roles.ts` when that file set changes.
 * Definitions re-import fresh, so a role file once read in a broken state recovers on the next cycle.
 */
export function createRolesTarget(from: string): SetTarget {
  return createSetTarget('roles', from, 'roles', roleFiles, (dir) =>
    generateRoles(dir, { fresh: true }),
  );
}

async function roleFiles(): Promise<Set<string>> {
  const roles = await collectRoles(stackedLayers(), { fresh: true });
  return new Set(roles.map((role) => role.file));
}
