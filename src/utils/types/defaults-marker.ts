/**
 * Maps an object to the marker shape `RequireByShape` consumes.
 * Nested objects recurse; arrays and scalar leaves become `true`.
 *
 * Pairing the result with `RequireByShape` makes exactly the source object's keys required.
 *
 * @example
 * ```ts
 * type M = DefaultsMarker<{ dirs: { codegen: string }; tags: string[] }>
 * // -> { dirs: { codegen: true }; tags: true }
 * ```
 */
export type DefaultsMarker<T> = {
  [K in keyof T]-?: T[K] extends readonly unknown[]
    ? true
    : T[K] extends object
      ? DefaultsMarker<T[K]>
      : true;
};
