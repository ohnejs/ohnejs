import type { Capability } from './known-capabilities.ts';

import { validateRoleDefinition } from './validate-role.ts';

/**
 * A role definition: a named bundle of capabilities.
 * The role name is not declared here; it comes from the file under `dirs.roles`.
 */
export interface RoleDefinition {
  /**
   * The capabilities the role grants.
   * The schema-derived names autocomplete; any custom dot-separated name is legal too.
   * `*` grants everything, and a `.*` suffix grants every capability under its prefix.
   */
  capabilities: readonly Capability[];
}

/**
 * Defines a role.
 *
 * Default-export the result from a file under a layer's `dirs.roles`.
 * The file names the role in kebab-case: `roles/content-editor.ts` becomes `content-editor`.
 * A user holds any number of roles; their capabilities union.
 *
 * @example
 * ```ts
 * // roles/editor.ts
 * import { defineRole } from 'ohnejs'
 *
 * export default defineRole({
 *   capabilities: ['collection.Posts.*', 'collection.Tags.read'],
 * })
 * ```
 */
export function defineRole(definition: RoleDefinition): RoleDefinition {
  validateRoleDefinition(definition);
  return definition;
}
