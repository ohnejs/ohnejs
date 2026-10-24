import { isUndefined } from '../is/is-undefined.ts';

/**
 * Resolves `specifier`, imported by the module at the URL path `base`, to a URL path, or `null`.
 */
export type ImportMapResolver = (specifier: string, base: string) => string | null;

/**
 * The origin URL paths are resolved against, so only their path and query matter.
 */
const ORIGIN = 'http://localhost';

/**
 * Creates a resolver that maps specifiers through an importmap's `imports`, as the browser does.
 *
 * An exact key wins, then the longest key ending in `/` that prefixes the specifier.
 * A path-like specifier (`/`, `./`, `../`) is first made absolute against `base`.
 * An unmapped path-like specifier resolves to itself.
 * An unmapped bare one resolves to `null`, as the browser refuses it.
 * A specifier with a scheme, like `https:` or `node:`, counts as bare.
 * Keys, values and results are URL paths with their query, normalized the way the browser parses them.
 *
 * @example
 * ```ts
 * const resolve = createImportMapResolver({
 *   'ohnejs/utils': '/m/utils/index.ts',
 *   'app/': '/m/app/',
 *   '/m/a.ts': '/m/a.ts?h=1',
 * })
 *
 * resolve('ohnejs/utils', '/m/b.ts') // -> '/m/utils/index.ts'
 * resolve('app/nav.ts', '/m/b.ts')   // -> '/m/app/nav.ts'
 * resolve('./a.ts', '/m/b.ts')       // -> '/m/a.ts?h=1'
 * resolve('../c.ts', '/m/x/b.ts')    // -> '/m/c.ts'
 * resolve('lodash', '/m/b.ts')       // -> null
 * ```
 */
export function createImportMapResolver(
  imports: Readonly<Record<string, string>>,
): ImportMapResolver {
  const exact = new Map<string, string>();
  const prefixes: [key: string, target: string][] = [];
  for (const [key, target] of Object.entries(imports)) {
    const normalized = isPathLike(key) ? urlPath(key, '/') : key;
    if (normalized.endsWith('/')) prefixes.push([normalized, urlPath(target, '/')]);
    else exact.set(normalized, urlPath(target, '/'));
  }
  prefixes.sort(([a], [b]) => b.length - a.length);

  return (specifier, base) => {
    const pathLike = isPathLike(specifier);
    const key = pathLike ? urlPath(specifier, base) : specifier;
    const target = exact.get(key);
    if (!isUndefined(target)) return target;
    const prefix = prefixes.find(([candidate]) => key.startsWith(candidate));
    if (!isUndefined(prefix)) return urlPath(key.slice(prefix[0].length), prefix[1]);
    return pathLike ? key : null;
  };
}

/**
 * Whether `specifier` is a URL path rather than a bare name: it starts with `/`, `./` or `../`.
 */
function isPathLike(specifier: string): boolean {
  return /^\.{0,2}\//.test(specifier);
}

/**
 * The path and query `path` names once resolved against the URL path `base`.
 */
function urlPath(path: string, base: string): string {
  const url = new URL(path, `${ORIGIN}${base}`);
  return `${url.pathname}${url.search}`;
}
