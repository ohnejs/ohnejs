import { uniqueArray } from '../../utils/index.ts';
import { resolveLayerSubpaths } from './resolve-layer-dir.ts';
import { resolveOhnePackages } from './resolve-ohne-layers.ts';

/**
 * Resolves the names of every layer the current app may list, in registration order.
 *
 * Every package in the app's dependency closure contributes its own name when its root is a layer.
 * The layers it exports as subpaths follow, so `@acme/kit/auth` sits right after `@acme/kit`.
 * A package without a root layer still contributes its subpath layers.
 * A dependency precedes its dependent; see `resolveOhnePackages` for how the closure is walked.
 * The app's own name is dropped, but the layers it exports itself come last.
 * Returns `[]` when no `package.json` is found.
 *
 * @example
 * ```ts
 * await resolveDependencyLayerNames()
 * // -> ['ohnejs', 'ohnejs/uploads', '@acme/base', '@acme/auth']
 *
 * await resolveDependencyLayerNames('/srv/lib')
 * // -> ['ohnejs', 'ohnejs/uploads']
 * ```
 */
export async function resolveDependencyLayerNames(from: string = process.cwd()): Promise<string[]> {
  const packages = await resolveOhnePackages(from);
  const names: string[] = [];
  for (const [index, pkg] of packages.entries()) {
    if (pkg.layer && index < packages.length - 1) names.push(pkg.name);
    names.push(...(await resolveLayerSubpaths(pkg.dir, pkg.name)));
  }
  return uniqueArray(names);
}
