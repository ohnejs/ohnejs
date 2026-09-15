/**
 * A value inside a `ConditionObject`.
 * A scalar is the `equalsTo` shorthand.
 * An object is a comparison or a nested group.
 * An array carries an operator's list (`in`) or a group's branches (`and`, `or`).
 *
 * @example
 * ```ts
 * const scalar: ConditionValue = 'published'
 * const nested: ConditionValue = { atLeast: 100 }
 * const list:   ConditionValue = [{ featured: true }, { pinned: true }]
 * ```
 */
export type ConditionValue =
  | string
  | number
  | boolean
  | readonly ConditionValue[]
  | ConditionObject;

/**
 * A condition in object form: the shape `parseCondition` reads.
 * A field key maps to a scalar (the `equalsTo` shorthand) or a comparison object of operators.
 * The logical keys `and`, `or`, and `not` group nested conditions.
 * This is the authoring surface; the parsed `ConditionNode` is what every consumer evaluates.
 *
 * @example
 * ```ts
 * const flat:    ConditionObject = { status: 'published', views: { atLeast: 100 } }
 * const grouped: ConditionObject = { or: [{ featured: true }, { pinned: true }] }
 * ```
 */
export type ConditionObject = {
  readonly [key: string]: ConditionValue;
};
