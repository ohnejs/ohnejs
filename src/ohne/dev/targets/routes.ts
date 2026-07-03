import { generateRoutes } from '../../codegen/generate-routes.ts';
import { stackedLayers } from '../../layers/stacked-layers.ts';
import { useConfig } from '../../layers/use-config.ts';
import { collectRoutes } from '../../routes/collect-routes.ts';
import { createSetTarget, type SetTarget } from './set-target.ts';

/**
 * The route table target.
 * Its closure is every layer's `dirs.api`; it regenerates `routes.ts` when that file set changes.
 */
export function createRoutesTarget(from: string): SetTarget {
  return createSetTarget('routes', from, 'api', routeFiles, generateRoutes);
}

async function routeFiles(): Promise<Set<string>> {
  const routes = await collectRoutes(stackedLayers(), {
    disable: useConfig().disable.routes,
  });
  return new Set(routes.map((route) => route.file));
}
