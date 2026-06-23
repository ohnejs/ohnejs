import type { Event } from '../http/event.ts';
import type { MiddlewareKey } from './known-middleware.ts';

/**
 * A request middleware.
 * Runs before the route handler, inside the request's `AsyncLocalStorage`, with the `Event` passed in.
 * Read or mutate `event.context`, set `event.response` headers and status, or short-circuit.
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
   * Absolute path of the file the middleware was discovered in.
   */
  file: string;

  /**
   * Name of the layer that owns the middleware.
   */
  layer: string;
}

declare module 'ohne' {
  interface Hooks {
    /**
     * Resolves which middleware run for a request, and in what order, before any of them runs.
     * Receives the run-order names plus the request event, and returns the names to run.
     * Return a new array to filter or reorder.
     * The argument is a per-request copy, so leaving it untouched is safe.
     */
    'middleware:resolve': (names: MiddlewareKey[], event: Event) => MiddlewareKey[];
  }
}
