import type { OhneLayer } from '../project/resolve-ohne-layers.ts';

import { compileGlob, type HTTPMethod, isNull, naturalCompare } from '../../utils/index.ts';
import { DIR_DEFAULTS } from '../layers/config.ts';
import { useLayers } from '../layers/use-layers.ts';
import { routeID, type RouteMeta } from './route.ts';
import { scanLayerRoutes } from './scan-layer-routes.ts';

/**
 * Options for `collectRoutes`.
 */
export interface CollectRoutesOptions {
  /**
   * Route ids to drop, as globs.
   * A glob with no method prefix matches a route's pattern regardless of method.
   * A glob with one matches only that method.
   *
   * @default
   * []
   */
  disable?: string[];
}

const METHOD_PREFIX_RE = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) (.+)$/i;

/**
 * Combines the routes of every layer into one effective route table.
 *
 * Each layer is scanned in its own handler directory, from that layer's own `dirs.api` (default `'api'`).
 * The value never comes from the cross-layer merge, so one layer cannot relocate another's handlers.
 *
 * Layers are scanned in order: when two produce the same route id, the closer layer wins.
 * Routes matched by `disable` are then dropped, and the table is sorted by id for stable output.
 *
 * @example
 * ```ts
 * await collectRoutes(
 *   [{ name: 'auth', dir: '/dep' }, { name: 'app', dir: '/app' }],
 *   { disable: ['/internal/**'] },
 * )
 * ```
 */
export async function collectRoutes(
  layers: readonly OhneLayer[],
  options: CollectRoutesOptions = {},
): Promise<RouteMeta[]> {
  const { disable = [] } = options;
  const configByPath = new Map(
    useLayers()
      .layers()
      .map((layer) => [layer.path, layer.input]),
  );

  const table = new Map<string, RouteMeta>();
  for (const layer of layers) {
    const dir = configByPath.get(layer.dir)?.dirs?.api ?? DIR_DEFAULTS.api;
    for (const route of await scanLayerRoutes(layer, dir)) {
      table.set(routeID(route.method, route.pattern), route);
    }
  }

  const drop = disabled(disable);
  return [...table.values()]
    .filter((route) => !drop(route))
    .sort((a, b) => naturalCompare(routeID(a.method, a.pattern), routeID(b.method, b.pattern)));
}

function disabled(globs: string[]): (route: RouteMeta) => boolean {
  const matchers = globs.map((glob) => {
    const prefixed = glob.match(METHOD_PREFIX_RE);
    if (isNull(prefixed)) {
      const match = compileGlob(glob);
      return (route: RouteMeta) => match(route.pattern);
    }
    const method = prefixed[1].toUpperCase() as HTTPMethod;
    const match = compileGlob(prefixed[2]);
    return (route: RouteMeta) => route.method === method && match(route.pattern);
  });

  return (route) => matchers.some((match) => match(route));
}
