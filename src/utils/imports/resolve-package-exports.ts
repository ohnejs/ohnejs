import { isArray } from '../is/is-array.ts';
import { isNull } from '../is/is-null.ts';
import { isObject } from '../is/is-object.ts';
import { isString } from '../is/is-string.ts';
import { isUndefined } from '../is/is-undefined.ts';
import { hasKey } from '../object/has-key.ts';

const CONDITIONS = new Set(['node-addons', 'node', 'import', 'module-sync', 'default']);

const INVALID_SEGMENT = /^(?:\.|\.\.|node_modules)$/i;

/**
 * Maps a subpath through a package's `exports` field to the target Node's `import` loads, or `null`.
 *
 * An exact key wins; else the best `*` pattern, by longest prefix and then longest key, fills its `*`.
 * A conditions object takes its first key that Node's `import` matches, so `types` and `require` never count.
 * A fallback array takes its first valid target, and a `null` target leaves the subpath unexported.
 * A target must start with `./` and stay inside the package; the result is relative to the package root.
 *
 * @example
 * ```ts
 * resolvePackageExports('./index.ts', '.')                           // -> './index.ts'
 * resolvePackageExports({ './*': { import: './src/*' } }, './x.ts')  // -> './src/x.ts'
 * resolvePackageExports({ './*': { require: './cjs/*' } }, './x.ts') // -> null
 * ```
 */
export function resolvePackageExports(exports: unknown, subpath: string): string | null {
  const map = exportsMap(exports);
  if (isNull(map)) return null;
  if (hasKey(map, subpath) && !subpath.includes('*'))
    return exportsTarget(map[subpath], '') ?? null;

  let best: string | undefined;
  for (const key of Object.keys(map)) {
    const star = key.indexOf('*');
    if (star === -1 || star !== key.lastIndexOf('*') || subpath.length < key.length) continue;
    if (!subpath.startsWith(key.slice(0, star)) || !subpath.endsWith(key.slice(star + 1))) continue;
    if (isUndefined(best) || ranksAbove(key, best)) best = key;
  }
  if (isUndefined(best)) return null;
  const star = best.indexOf('*');
  const fill = subpath.slice(star, subpath.length - (best.length - star - 1));
  return exportsTarget(map[best], fill) ?? null;
}

/**
 * The `exports` field as a subpath map with its `.` sugar unwrapped, or `null` when its keys mix kinds.
 */
function exportsMap(exports: unknown): Record<string, unknown> | null {
  if (isString(exports) || isArray(exports)) return { '.': exports };
  if (!isObject(exports)) return null;
  const keys = Object.keys(exports);
  const subpaths = keys.filter((key) => key.startsWith('.')).length;
  if (subpaths === 0) return { '.': exports };
  return subpaths === keys.length ? exports : null;
}

/**
 * Resolves one `exports` target with `fill` for its `*`.
 * Returns `undefined` when no condition matches, so a conditions object moves on to its next key.
 */
function exportsTarget(target: unknown, fill: string): string | null | undefined {
  if (isString(target)) {
    const resolved = target.replaceAll('*', fill);
    if (!target.startsWith('./')) return null;
    return resolved
      .split('/')
      .slice(1)
      .some((segment) => INVALID_SEGMENT.test(segment))
      ? null
      : resolved;
  }
  if (isArray(target)) {
    let excluded: null | undefined;
    for (const fallback of target) {
      const resolved = exportsTarget(fallback, fill);
      if (isString(resolved)) return resolved;
      if (isNull(resolved)) excluded = null;
    }
    return excluded;
  }
  if (!isObject(target)) return isNull(target) ? null : undefined;
  for (const [condition, value] of Object.entries(target)) {
    if (!CONDITIONS.has(condition)) continue;
    const resolved = exportsTarget(value, fill);
    if (!isUndefined(resolved)) return resolved;
  }
  return undefined;
}

/**
 * Whether pattern key `a` beats `b` as Node ranks them: the longer prefix before `*`, then the longer key.
 */
function ranksAbove(a: string, b: string): boolean {
  const star = a.indexOf('*') - b.indexOf('*');
  return star === 0 ? a.length > b.length : star > 0;
}
