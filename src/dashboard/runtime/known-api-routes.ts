import type { LiteralUnion } from '../../utils/types/literal-union.ts';

/**
 * Codegen extension point for the known API route ids the dashboard may call.
 * Empty until codegen runs; the `browser/routes.ts` it emits augments this with one member per route.
 * Each member is a route id, either `'{METHOD} {pattern}'` or a bare `pattern` for an any-method route.
 *
 * It mirrors the Node-side `KnownRoutes`, so `api` suggests a route id exactly as the server registers it.
 * `type` aliases cannot be augmented, so the overridable ids live on this interface instead.
 *
 * @example
 * ```ts
 * declare module 'ohne/dashboard' {
 *   interface KnownAPIRoutes {
 *     'GET /authors/[id]': true
 *   }
 * }
 * ```
 */
export interface KnownAPIRoutes {}

/**
 * A route id `api` accepts.
 * The known ids are suggested for autocomplete; any other string is still allowed.
 * A leading `{METHOD} ` is parsed off as the request method, so the rest is the path.
 */
export type APIRouteID = LiteralUnion<keyof KnownAPIRoutes>;
