import type { RoleDefinition } from './define-role.ts';
import type { RoleName } from './known-roles.ts';

import { createRegistry, type Registry } from '../../utils/index.ts';

/**
 * One registered role: its name and its definition.
 */
export interface RoleMeta {
  /**
   * The role name, taken from its file.
   */
  name: RoleName;

  /**
   * The role definition.
   */
  role: RoleDefinition;
}

const registry: Registry<RoleMeta> = createRegistry<RoleMeta>();

/**
 * Returns the process-wide role registry, keyed by role name.
 *
 * Core ships no roles; codegen registers every layer's own.
 * A name that already exists is overridden, so a role from a closer layer wins.
 *
 * @example
 * ```ts
 * useRoles().get('admin')?.role.capabilities // -> ['*']
 * ```
 */
export function useRoles(): Registry<RoleMeta> {
  return registry;
}
