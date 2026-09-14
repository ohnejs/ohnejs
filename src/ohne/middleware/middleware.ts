import type { Event } from '../http/event.ts';
import type { MiddlewareKey } from './known-middleware.ts';

/**
 * A request middleware.
 * Runs before the route handler, inside the request's `AsyncLocalStorage`, with the `Event` passed in.
 * Read or mutate `event.context`, set `event.response` headers and status, or short-circuit.
 *
 * A middleware under the `global/` directory runs on every request.
 * Any other runs only when a route opts into it through `defineHandler`'s `middleware` option.
 *
 * Returning `undefined` continues to the next middleware, then the handler.
 * Returning any other value short-circuits: that value becomes the response and the handler never runs.
 * A thrown or returned `HTTPError` maps to its status, exactly as from a handler.
 */
export type Middleware = (event: Event) => unknown;

/**
 * Static metadata for a middleware, independent of its function.
 * This is what middleware discovery produces and what codegen serialises.
 */
export interface MiddlewareMeta {
  /**
   * Resolved kebab-case name, from the file's path under the layer's middleware directory.
   * `middleware/foo/bar.ts` becomes `foo-bar`; a closer layer's same name overrides.
   */
  name: string;

  /**
   * Whether the middleware is global.
   * Global middleware live under the `global/` directory and run on every request, before named ones.
   * A named middleware runs only when a route selects it.
   */
  isGlobal: boolean;

  /**
   * Absolute path of the file the middleware was discovered in.
   */
  file: string;

  /**
   * Name of the layer that owns the middleware.
   */
  layer: string;
}

declare module 'ohnejs' {
  interface Hooks {
    /**
     * Filters or reorders the middleware for a request, after globals and the route's selection resolve.
     * Receives the run-order names - globals first, then the route's selection - plus the request event.
     * Returns the names to run, as a filtered or reordered list.
     * A secondary escape hatch for dynamic, per-request control; routine selection belongs on the route.
     * The argument is a per-request copy, so leaving it untouched is safe.
     */
    'middleware:resolve': (names: MiddlewareKey[], event: Event) => MiddlewareKey[];
  }
}
