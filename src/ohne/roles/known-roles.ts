/**
 * Codegen extension point for every known role name.
 * Empty until codegen runs; the `roles.ts` it emits augments this with one member per role.
 *
 * `type` aliases cannot be augmented, so the role names live on this interface instead.
 *
 * @example
 * ```ts
 * declare module 'ohnejs' {
 *   interface KnownRoles {
 *     admin: true
 *   }
 * }
 * ```
 */
export interface KnownRoles {}

/**
 * The name of a registered role, as the files under `dirs.roles` name them.
 * Narrows to the generated union of names once codegen has run; falls back to `string` until then.
 */
export type RoleName = [keyof KnownRoles] extends [never] ? string : keyof KnownRoles;
