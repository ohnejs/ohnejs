import { readJSON, resolveModuleDir } from '../../utils/fs/index.ts';
import {
  dirname,
  hasKey,
  isNull,
  isObject,
  isString,
  joinPath,
  normalizePath,
} from '../../utils/index.ts';

/**
 * A layer specifier split into the package it names and the `exports` subpath within it.
 */
export interface LayerSpecifier {
  /**
   * The package name, scope included: `@acme/kit` for `@acme/kit/auth`.
   */
  name: string;

  /**
   * The `exports` subpath: `./auth` for `@acme/kit/auth`, or `.` for a bare name.
   */
  subpath: string;
}

const CONDITIONS = new Set(['node', 'import', 'default']);

/**
 * Resolves a layer specifier to the directory that holds its `ohne.config.ts`.
 *
 * A bare package name (`@acme/base`) resolves to the package root.
 * A name carrying a subpath (`@acme/kit/auth`) resolves through the package's `exports`.
 * The subpath maps to a file - by convention the layer's `ohne.config.ts`.
 * Its directory is the layer, so one package can ship several layers as exported subfolders.
 *
 * The package is looked up in `node_modules` from `from`, as Node would.
 * Use `resolveLayerSubpath` when the package root is already known.
 *
 * Returns the absolute, normalized directory.
 * Yields `null` when the package is not installed, or the subpath is not exported.
 *
 * @example
 * ```ts
 * await resolveLayerDir('@acme/base', '/srv/app')
 * // -> '/srv/app/node_modules/@acme/base' | null
 *
 * await resolveLayerDir('@acme/kit/auth', '/srv/app')
 * // -> '/srv/.../@acme/kit/auth' | null
 * ```
 */
export async function resolveLayerDir(specifier: string, from: string): Promise<string | null> {
  const { name, subpath } = parseLayerSpecifier(specifier);
  const root = await resolveModuleDir(name, from);
  return isNull(root) ? null : resolveLayerSubpath(root, subpath);
}

/**
 * Splits a layer specifier into its package name and `exports` subpath.
 *
 * A scoped name keeps its first two segments, a plain name its first.
 * Whatever follows becomes the subpath; a bare name yields `.`.
 *
 * @example
 * ```ts
 * parseLayerSpecifier('@acme/kit/auth') // -> { name: '@acme/kit', subpath: './auth' }
 * parseLayerSpecifier('ohne/uploads')   // -> { name: 'ohne', subpath: './uploads' }
 * parseLayerSpecifier('@acme/base')     // -> { name: '@acme/base', subpath: '.' }
 * ```
 */
export function parseLayerSpecifier(specifier: string): LayerSpecifier {
  const segments = specifier.split('/');
  const count = specifier.startsWith('@') ? 2 : 1;
  const name = segments.slice(0, count).join('/');
  const rest = segments.slice(count).join('/');
  return { name, subpath: rest ? `./${rest}` : '.' };
}

/**
 * Resolves an `exports` subpath within package `root` to the directory that holds its `ohne.config.ts`.
 *
 * The `.` subpath is the root itself.
 * Any other subpath maps through the package's `exports`: an exact key first, else the longest `*` pattern.
 * A conditional target resolves like Node does: the first of `node`, `import`, or `default`, in key order.
 * `types` never counts.
 *
 * Returns the absolute, normalized directory, or `null` when the subpath is not exported.
 *
 * @example
 * ```ts
 * await resolveLayerSubpath('/srv/app', '.')         // -> '/srv/app'
 * await resolveLayerSubpath('/srv/app', './uploads') // -> '/srv/app/uploads' | null
 * ```
 */
export async function resolveLayerSubpath(root: string, subpath: string): Promise<string | null> {
  if (subpath === '.') return root;

  const manifest = await readJSON<{ exports?: unknown }>(joinPath(root, 'package.json'));
  const target = resolveExports(manifest?.exports, subpath);
  if (isNull(target)) return null;
  return normalizePath(dirname(joinPath(root, target)));
}

/**
 * Maps an `exports` subpath to its target string, or `null` when the map does not export it.
 * An exact key is authoritative; otherwise the longest matching `*` pattern wins and its fill is substituted.
 */
function resolveExports(exports: unknown, subpath: string): string | null {
  if (!isObject(exports)) return null;
  if (hasKey(exports, subpath)) return resolveTarget(exports[subpath]);

  let target: string | null = null;
  let matchLength = -1;
  for (const [key, value] of Object.entries(exports)) {
    const star = key.indexOf('*');
    if (star === -1 || key.length - 1 <= matchLength) continue;
    const prefix = key.slice(0, star);
    const suffix = key.slice(star + 1);
    if (subpath.length < prefix.length + suffix.length) continue;
    if (!subpath.startsWith(prefix) || !subpath.endsWith(suffix)) continue;
    const pattern = resolveTarget(value);
    if (isNull(pattern)) continue;
    const fill = subpath.slice(prefix.length, subpath.length - suffix.length);
    target = pattern.replaceAll('*', fill);
    matchLength = key.length - 1;
  }
  return target;
}

/**
 * Unwraps an `exports` target to a string.
 * A string passes as is.
 * A conditions object resolves through its first matching condition, in key order.
 * Only `node`, `import`, and `default` count; `types` and unknown conditions never resolve.
 */
function resolveTarget(target: unknown): string | null {
  if (isString(target)) return target;
  if (!isObject(target)) return null;
  for (const [condition, value] of Object.entries(target)) {
    if (!CONDITIONS.has(condition)) continue;
    const resolved = resolveTarget(value);
    if (!isNull(resolved)) return resolved;
  }
  return null;
}
