import { parseRouteID } from './parse-route-id.ts';

/**
 * Returns whether a list of served route ids serves `id`.
 * True when `id` is listed, or when a `METHOD /pattern` id's bare `/pattern` is.
 * A bare id names a route that answers every method, so it serves each method-bound id on its pattern.
 *
 * @example
 * ```ts
 * hasRoute(['POST /quests'], 'POST /quests') // -> true
 * hasRoute(['/quests'], 'POST /quests')      // -> true
 * hasRoute(['GET /quests'], 'POST /quests')  // -> false
 * hasRoute([], 'POST /quests')               // -> false
 * ```
 */
export function hasRoute(routes: readonly string[], id: string): boolean {
  return routes.includes(id) || routes.includes(parseRouteID(id).path);
}
