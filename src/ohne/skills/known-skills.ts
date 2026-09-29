/**
 * Codegen extension point for every known skill name.
 * Empty until codegen runs; the `skills.ts` it emits augments this with one member per skill.
 *
 * `type` aliases cannot be augmented, so the skill names live on this interface instead.
 *
 * @example
 * ```ts
 * declare module 'ohnejs' {
 *   interface KnownSkills {
 *     'translate-items': true
 *   }
 * }
 * ```
 */
export interface KnownSkills {}

/**
 * The name of a registered skill, as the files under `dirs.skills` name them.
 * Narrows to the generated union of names once codegen has run; falls back to `string` until then.
 */
export type SkillName = [keyof KnownSkills] extends [never] ? string : keyof KnownSkills;
