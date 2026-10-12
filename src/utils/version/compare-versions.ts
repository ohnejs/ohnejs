import { isUndefined } from '../is/is-undefined.ts';
import { parsed } from './_parsed.ts';

const NUMERIC = /^\d+$/;

/**
 * Orders two versions by semver precedence: negative when `a` comes first, positive when `b` does.
 * A release follows its prereleases, and identifiers compare numerically when both are numbers.
 * A string that is not a version throws.
 *
 * @example
 * ```ts
 * ['1.0.0', '1.0.0-rc.1', '1.0.0-beta.11', '1.0.0-beta.2', '0.10.0', '0.9.0'].sort(compareVersions)
 * // -> ['0.9.0', '0.10.0', '1.0.0-beta.2', '1.0.0-beta.11', '1.0.0-rc.1', '1.0.0']
 * ```
 */
export function compareVersions(a: string, b: string): number {
  const left = parsed(a);
  const right = parsed(b);
  const core = left.major - right.major || left.minor - right.minor || left.patch - right.patch;
  if (core !== 0) return core;

  const [x, y] = [left.prerelease, right.prerelease];
  if (x.length === 0 || y.length === 0) return y.length - x.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const p = x[i];
    const q = y[i];
    if (isUndefined(p) || isUndefined(q)) return isUndefined(p) ? -1 : 1;
    if (p === q) continue;
    if (NUMERIC.test(p) && NUMERIC.test(q)) return Number(p) - Number(q);
    if (NUMERIC.test(p) !== NUMERIC.test(q)) return NUMERIC.test(p) ? -1 : 1;
    return p < q ? -1 : 1;
  }
  return 0;
}
