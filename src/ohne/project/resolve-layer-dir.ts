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
import { isOhneProject } from './is-ohne-project.ts';

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
 * A bare package name (`@acme/blog`) resolves to the package root.
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
 * await resolveLayerDir('@acme/blog', '/srv/app')
 * // -> '/srv/app/node_modules/@acme/blog' | null
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
 * parseLayerSpecifier('ohnejs/uploads') // -> { name: 'ohnejs', subpath: './uploads' }
 * parseLayerSpecifier('@acme/blog')     // -> { name: '@acme/blog', subpath: '.' }
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
 * Any other subpath maps through the package's `exports`: an exact key first, else a `*` pattern.
 * Among patterns, the longest prefix before the `*` wins, then the longest key, as Node ranks them.
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
  return subpathDir(root, manifest?.exports, subpath);
}

/**
 * Lists the `exports` subpaths of the package at `root` that are layers of their own, as specifiers.
 * An exact subpath counts when its target's directory holds an `ohne.config.ts` and is not the root itself.
 * A `*` pattern and the `.` root never count.
 *
 * @example
 * ```ts
 * await resolveLayerSubpaths('/srv/app/node_modules/@acme/kit', '@acme/kit') // -> ['@acme/kit/auth']
 * ```
 */
export async function resolveLayerSubpaths(root: string, name: string): Promise<string[]> {
  const manifest = await readJSON<{ exports?: unknown }>(joinPath(root, 'package.json'));
  const exports = manifest?.exports;
  if (!isObject(exports)) return [];

  const base = normalizePath(root);
  const specifiers: string[] = [];
  for (const subpath of Object.keys(exports)) {
    if (!subpath.startsWith('./') || subpath.includes('*')) continue;
    const dir = subpathDir(root, exports, subpath);
    if (isNull(dir) || dir === base || !(await isOhneProject(dir))) continue;
    specifiers.push(`${name}/${subpath.slice(2)}`);
  }
  return specifiers;
}

/**
 * The directory an `exports` subpath's target lives in, absolute and normalized, or `null` when unexported.
 */
function subpathDir(root: string, exports: unknown, subpath: string): string | null {
  const target = resolveExports(exports, subpath);
  return isNull(target) ? null : normalizePath(dirname(joinPath(root, target)));
}

/**
 * Maps an `exports` subpath to its target string, or `null` when the map does not export it.
 * An exact key is authoritative; otherwise the best matching `*` pattern wins and its fill is substituted.
 */
function resolveExports(exports: unknown, subpath: string): string | null {
  if (!isObject(exports)) return null;
  if (hasKey(exports, subpath)) return resolveTarget(exports[subpath]);

  let target: string | null = null;
  let bestStar = -1;
  let bestLength = -1;
  for (const [key, value] of Object.entries(exports)) {
    const star = key.indexOf('*');
    if (star === -1 || star < bestStar || (star === bestStar && key.length <= bestLength)) continue;
    const prefix = key.slice(0, star);
    const suffix = key.slice(star + 1);
    if (subpath.length < key.length) continue;
    if (!subpath.startsWith(prefix) || !subpath.endsWith(suffix)) continue;
    const pattern = resolveTarget(value);
    if (isNull(pattern)) continue;
    const fill = subpath.slice(prefix.length, subpath.length - suffix.length);
    target = pattern.replaceAll('*', fill);
    bestStar = star;
    bestLength = key.length;
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
