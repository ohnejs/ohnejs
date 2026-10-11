/**
 * Codegen extension point for the roles the app declares.
 * Empty until codegen runs; the `browser/roles.ts` it emits extends it with every role.
 *
 * `type` aliases cannot be augmented, so the known names live on this interface instead.
 *
 * @example
 * ```ts
 * declare module 'ohnejs/dashboard' {
 *   interface KnownRoles {
 *     editor: true
 *   }
 * }
 * ```
 */
export interface KnownRoles {}

/**
 * The name of a declared role, as a user's `roles` field stores it.
 * Narrows to the generated union of names once codegen has run; falls back to `string` until then.
 */
export type RoleName = [keyof KnownRoles] extends [never] ? string : keyof KnownRoles;
