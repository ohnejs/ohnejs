import type { PeerRange } from './peer-range.ts';

import { parsed } from './_parsed.ts';
import { compareVersions } from './compare-versions.ts';
import { isPrerelease } from './is-prerelease.ts';

/**
 * Whether `range` takes `version`, as npm reads it.
 * A release is taken from the floor up to the ceiling, the ceiling's own prereleases left out.
 * A prerelease is taken only when the floor or the ceiling is a prerelease of the same version.
 * A `version` that is not a version throws.
 *
 * @example
 * ```ts
 * const range = { floor: '0.1.0', ceiling: '0.2.0', exact: false }
 *
 * admitsVersion(range, '0.1.9')        // -> true
 * admitsVersion(range, '0.2.0-beta.1') // -> false
 * admitsVersion(range, '0.1.1-beta.0') // -> false
 * ```
 */
export function admitsVersion(range: PeerRange, version: string): boolean {
  if (range.exact) return compareVersions(range.floor, version) === 0;
  const end = isPrerelease(range.ceiling) ? range.ceiling : `${range.ceiling}-0`;
  if (compareVersions(version, range.floor) < 0 || compareVersions(version, end) >= 0) return false;
  if (!isPrerelease(version)) return true;
  const core = (of: string): string => {
    const { major, minor, patch } = parsed(of);
    return `${major}.${minor}.${patch}`;
  };
  return [range.floor, range.ceiling].some(
    (bound) => isPrerelease(bound) && core(bound) === core(version),
  );
}
