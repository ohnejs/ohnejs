/**
 * Codegen extension point for the known route ids.
 * Empty until codegen runs; the `routes.ts` it emits augments this with one member per route.
 * Each member maps a route id to the type of its handler.
 *
 * `type` aliases cannot be augmented, so the overridable ids live on this interface instead.
 *
 * @example
 * ```ts
 * declare module 'ohne' {
 *   interface KnownRoutes {
 *     'GET /users/[id]': typeof import('../api/users/[id].get.ts').default
 *   }
 * }
 * ```
 */
export interface KnownRoutes {}

/**
 * The id of a route in the app's combined route table.
 * Narrows to the generated union of route ids once codegen has run; falls back to `string` until then.
 */
export type RouteKey = [keyof KnownRoutes] extends [never] ? string : keyof KnownRoutes;
