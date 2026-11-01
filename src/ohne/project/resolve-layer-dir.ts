import { readJSON, resolveModuleDir } from '../../utils/fs/index.ts';
import {
  type PackageSpecifier,
  parsePackageSpecifier,
  resolvePackageExports,
} from '../../utils/imports/index.ts';
import { dirname, isNull, isObject, joinPath, normalizePath } from '../../utils/index.ts';
import { isOhneProject } from './is-ohne-project.ts';

/**
 * A layer specifier split into the package it names and the `exports` subpath within it.
 */
export type LayerSpecifier = PackageSpecifier;

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
  return parsePackageSpecifier(specifier);
}

/**
 * Resolves an `exports` subpath within package `root` to the directory that holds its `ohne.config.ts`.
 *
 * The `.` subpath is the root itself.
 * Any other subpath maps through the package's `exports` as `resolvePackageExports` maps it.
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
  const target = resolvePackageExports(exports, subpath);
  return isNull(target) ? null : normalizePath(dirname(joinPath(root, target)));
}
