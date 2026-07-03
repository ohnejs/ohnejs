import { isAbsolutePath } from './is-absolute-path.ts';
import { normalizePath } from './normalize-path.ts';
import { pathRoot } from './path-root.ts';

/**
 * Returns the relative path from `from` to `to`.
 * Both inputs are normalized first.
 * A relative `from` must not keep leading `..` segments after normalization.
 * Such segments are not lexically invertible; the result treats them as ordinary names.
 *
 * If one path is absolute and the other relative, the normalized `to` is returned unchanged.
 * The same holds if both are absolute but on different roots (different drive letters or UNC shares).
 *
 * @example
 * ```ts
 * relativePath('/a/b/c', '/a/b/d') // -> '../d'
 * relativePath('/a/b', '/a/b/c')   // -> 'c'
 * relativePath('a/b', 'a/b')       // -> ''
 * relativePath('a/b', 'a/c')       // -> '../c'
 * relativePath('C:/a/b', 'D:/x')   // -> 'D:/x'
 * ```
 */
export function relativePath(from: string, to: string): string {
  const fromNorm = normalizePath(from);
  const toNorm = normalizePath(to);
  if (fromNorm === toNorm) return '';

  const fromAbs = isAbsolutePath(fromNorm);
  const toAbs = isAbsolutePath(toNorm);
  if (fromAbs !== toAbs) return toNorm;

  if (fromAbs && pathRoot(fromNorm) !== pathRoot(toNorm)) return toNorm;

  const fromParts = fromNorm.split('/').filter((segment) => segment.length > 0 && segment !== '.');
  const toParts = toNorm.split('/').filter((segment) => segment.length > 0 && segment !== '.');

  let common = 0;
  while (
    common < fromParts.length &&
    common < toParts.length &&
    fromParts[common] === toParts[common]
  ) {
    common++;
  }

  const up = Array<string>(fromParts.length - common).fill('..');
  const down = toParts.slice(common);
  return [...up, ...down].join('/') || '.';
}
