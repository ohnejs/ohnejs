import type { ConditionObject } from './condition-object.ts';

/**
 * A condition that holds when every keyword appears in at least one of `fields`.
 * Each keyword becomes an `or` of `contains` over the fields, and the keywords combine with `and`.
 * `contains` matches case-insensitively, so the keywords pass through as given.
 *
 * No keywords holds for every record; no fields holds for none.
 *
 * @example
 * ```ts
 * keywordsCondition(['ada', 'math'], ['name', 'bio'])
 * // -> { and: [
 * //   { or: [{ name: { contains: 'ada' } }, { bio: { contains: 'ada' } }] },
 * //   { or: [{ name: { contains: 'math' } }, { bio: { contains: 'math' } }] }
 * // ] }
 * ```
 */
export function keywordsCondition(
  keywords: readonly string[],
  fields: readonly string[],
): ConditionObject {
  return {
    and: keywords.map((keyword) => ({
      or: fields.map((field) => ({ [field]: { contains: keyword } })),
    })),
  };
}
