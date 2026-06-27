import { readJSON, resolveModuleDir } from '../../utils/fs/index.ts';
import { dirname, isNull, isObject, isString, joinPath, normalizePath } from '../../utils/index.ts';

/**
 * Resolves a layer specifier to the directory that holds its `ohne.config.ts`.
 *
 * A bare package name (`@acme/base`) resolves to the package root.
 * A name carrying a subpath (`@acme/kit/auth`) resolves through the package's `exports`.
 * The subpath maps to a file - by convention the layer's `ohne.config.ts`.
 * Its directory is the layer, so one package can ship several layers as exported subfolders.
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
  const { name, subpath } = parseSpecifier(specifier);
  const root = await resolveModuleDir(name, from);
  if (isNull(root) || subpath === '.') return root;

  const manifest = await readJSON<{ exports?: unknown }>(joinPath(root, 'package.json'));
  const target = resolveExports(manifest?.exports, subpath);
  if (isNull(target)) return null;
  return normalizePath(dirname(joinPath(root, target)));
}

function parseSpecifier(specifier: string): { name: string; subpath: string } {
  const segments = specifier.split('/');
  const count = specifier.startsWith('@') ? 2 : 1;
  const name = segments.slice(0, count).join('/');
  const rest = segments.slice(count).join('/');
  return { name, subpath: rest ? `./${rest}` : '.' };
}

function resolveExports(exports: unknown, subpath: string): string | null {
  if (!isObject(exports)) return null;

  const exact = exports[subpath];
  if (isString(exact)) return exact;

  let target: string | null = null;
  let matchLength = -1;
  for (const [key, value] of Object.entries(exports)) {
    const star = key.indexOf('*');
    if (star === -1 || !isString(value) || key.length - 1 <= matchLength) continue;
    const prefix = key.slice(0, star);
    const suffix = key.slice(star + 1);
    if (subpath.length < prefix.length + suffix.length) continue;
    if (!subpath.startsWith(prefix) || !subpath.endsWith(suffix)) continue;
    const fill = subpath.slice(prefix.length, subpath.length - suffix.length);
    target = value.replaceAll('*', fill);
    matchLength = key.length - 1;
  }
  return target;
}
