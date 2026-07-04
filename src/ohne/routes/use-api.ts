import type { KnownRoutes } from './known-routes.ts';
import type { AnyHandler, Route } from './route.ts';

import { useRoutes } from './use-routes.ts';

/**
 * A single route as seen through `useAPI`: its metadata plus a precisely typed handler ref.
 */
export type APIRoute<H extends AnyHandler = AnyHandler> = Omit<Route, 'handler'> & {
  /**
   * The route's handler, typed from its source file.
   */
  handler: H;
};

/**
 * The typed API surface: every known route id mapped to its `APIRoute`.
 * Falls back to a string-keyed record until codegen has run.
 */
export type API = [keyof KnownRoutes] extends [never]
  ? Record<string, APIRoute>
  : {
      [K in keyof KnownRoutes]: APIRoute<
        KnownRoutes[K] extends AnyHandler ? KnownRoutes[K] : AnyHandler
      >;
    };

/**
 * Returns the typed view over the combined route table.
 *
 * Each entry exposes the route's metadata and a handler ref typed from its source file.
 *
 * @example
 * ```ts
 * const api = useAPI()
 *
 * api['GET /authors/[id]'].pattern // -> '/authors/[id]'
 * api['GET /authors/[id]'].handler // -> the typed handler ref
 * ```
 */
export function useAPI(): API {
  return useRoutes().all() as unknown as API;
}
