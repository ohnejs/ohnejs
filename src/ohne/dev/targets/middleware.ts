import { generateMiddleware } from '../../codegen/generate-middleware.ts';
import { stackedLayers } from '../../layers/stacked-layers.ts';
import { collectMiddleware } from '../../middleware/collect-middleware.ts';
import { createSetTarget, type SetTarget } from './set-target.ts';

/**
 * The middleware table target.
 * Its closure is every layer's `dirs.middleware`; it regenerates `middleware.ts` when that file set changes.
 */
export function createMiddlewareTarget(from: string): SetTarget {
  return createSetTarget('middleware', from, 'middleware', middlewareFiles, generateMiddleware);
}

/**
 * The source files of every stacked layer's middleware, the set whose change regenerates the table.
 */
async function middlewareFiles(): Promise<Set<string>> {
  const middleware = await collectMiddleware(stackedLayers());
  return new Set(middleware.map((entry) => entry.file));
}
