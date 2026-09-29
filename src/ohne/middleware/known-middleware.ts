/**
 * Codegen extension point for every known middleware name, global and named.
 * Empty until codegen runs; the `middleware.ts` it emits augments this with one member per middleware.
 * Each member maps a resolved name to the type of its middleware function.
 *
 * `type` aliases cannot be augmented, so the overridable names live on this interface instead.
 *
 * @example
 * ```ts
 * declare module 'ohnejs' {
 *   interface KnownMiddleware {
 *     'auth': typeof import('../middleware/auth.ts').default
 *   }
 * }
 * ```
 */
export interface KnownMiddleware {}

/**
 * The resolved name of any middleware, global or named, in the app's combined table.
 * Narrows to the generated union of names once codegen has run; falls back to `string` until then.
 */
export type MiddlewareKey = [keyof KnownMiddleware] extends [never]
  ? string
  : keyof KnownMiddleware;

/**
 * Codegen extension point for the named, opt-in middleware names.
 * Holds only the middleware outside `global/`, since those are the ones a route can select.
 * Empty until codegen runs; the `middleware.ts` it emits augments this with one member per named middleware.
 *
 * `type` aliases cannot be augmented, so the overridable names live on this interface instead.
 *
 * @example
 * ```ts
 * declare module 'ohnejs' {
 *   interface KnownNamedMiddleware {
 *     'audit-log': typeof import('../middleware/audit-log.ts').default
 *   }
 * }
 * ```
 */
export interface KnownNamedMiddleware {}

/**
 * The resolved name of a named, opt-in middleware, the kind a route selects with `defineHandler`.
 * The generated union of named names, excluding the global ones.
 * Narrows only once the app has at least one named middleware.
 * With globals only, or before codegen, it stays `string`, since no named name exists to select.
 */
export type NamedMiddlewareKey = [keyof KnownNamedMiddleware] extends [never]
  ? string
  : keyof KnownNamedMiddleware;
