import { generateMiddleware } from '../../codegen/generate-middleware.ts';
import { collectMiddleware } from '../../middleware/collect-middleware.ts';
import { resolveOhneLayers } from '../../project/resolve-ohne-layers.ts';
import { createSetTarget, type SetTarget } from './set-target.ts';

/**
 * The middleware table target.
 * Its closure is every layer's `dirs.middleware`; it regenerates `middleware.ts` when that file set changes.
 */
export function createMiddlewareTarget(from: string): SetTarget {
  return createSetTarget('middleware', from, 'middleware', middlewareFiles, generateMiddleware);
}

async function middlewareFiles(from: string): Promise<Set<string>> {
  const middleware = await collectMiddleware(await resolveOhneLayers(from));
  return new Set(middleware.map((entry) => entry.file));
}
