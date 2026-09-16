import type { Message } from '../messages/known-messages.ts';
import type { Capability } from './known-capabilities.ts';

import { validateRoleDefinition } from './validate-role.ts';

/**
 * A role definition: a named bundle of capabilities.
 * The role name is not declared here; it comes from the file under `dirs.roles`.
 */
export interface RoleDefinition {
  /**
   * A short label for the role, shown where the dashboard picks or lists roles.
   * Pass a message key to translate it per the viewer's language.
   * A `{ key, params }` object supplies a parameterized message; a plain string is shown as-is.
   * Omitted, the role name is sentence-cased: `content-editor` becomes `Content editor`.
   *
   * @example
   * ```ts
   * label: 'Editor'
   * label: 'app.roles.editor.label'
   * ```
   */
  label?: Message;

  /**
   * What the role grants, in a sentence; the dashboard shows it as a hint beside the label.
   * Resolves like `label`.
   *
   * @example
   * ```ts
   * description: 'Writes and publishes posts.'
   * description: 'app.roles.editor.description'
   * ```
   */
  description?: Message;

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
 *   label: 'app.roles.editor.label',
 *   description: 'app.roles.editor.description',
 *   capabilities: ['collection.Posts.*', 'collection.Tags.read'],
 * })
 * ```
 */
export function defineRole(definition: RoleDefinition): RoleDefinition {
  validateRoleDefinition(definition);
  return definition;
}
