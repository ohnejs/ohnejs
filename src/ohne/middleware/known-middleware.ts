/**
 * Codegen extension point for the known middleware names.
 * Empty until codegen runs; the `middleware.ts` it emits augments this with one member per middleware.
 * Each member maps a resolved name to the type of its middleware function.
 *
 * `type` aliases cannot be augmented, so the overridable names live on this interface instead.
 *
 * @example
 * ```ts
 * declare module 'ohne' {
 *   interface KnownMiddleware {
 *     'auth': typeof import('../middleware/auth.ts').default
 *   }
 * }
 * ```
 */
export interface KnownMiddleware {}

/**
 * The resolved name of a middleware in the app's combined middleware table.
 * Narrows to the generated union of names once codegen has run; falls back to `string` until then.
 */
export type MiddlewareKey = [keyof KnownMiddleware] extends [never]
  ? string
  : keyof KnownMiddleware;
