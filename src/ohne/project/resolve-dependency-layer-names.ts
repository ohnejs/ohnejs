import { uniqueArray } from '../../utils/index.ts';
import { resolveOhneLayers } from './resolve-ohne-layers.ts';

/**
 * Resolves the names of the ohne layers the current app depends on, in registration order.
 * The app itself is never included.
 *
 * This is `resolveOhneLayers` reduced to names, with the app dropped.
 * A dependency therefore precedes its dependent; see `resolveOhneLayers` for how the closure is walked.
 * Returns `[]` when no `package.json` is found.
 *
 * @example
 * ```ts
 * await resolveDependencyLayerNames()
 * // -> ['ohne', '@acme/base', '@acme/auth']
 *
 * await resolveDependencyLayerNames('/srv/lib')
 * // -> ['ohne']
 * ```
 */
export async function resolveDependencyLayerNames(from: string = process.cwd()): Promise<string[]> {
  const layers = await resolveOhneLayers(from);
  return uniqueArray(layers.slice(0, -1).map((layer) => layer.name));
}
