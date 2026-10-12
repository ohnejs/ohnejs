import type { Version } from './version.ts';

import { parseVersion } from './parse-version.ts';

/**
 * `parseVersion` for a helper that has no answer for a string that is not a version, so it throws.
 *
 * @example
 * ```ts
 * parsed('0.1.0') // -> { major: 0, minor: 1, patch: 0, prerelease: [] }
 * parsed('x')     // throws
 * ```
 */
export function parsed(version: string): Version {
  const read = parseVersion(version);
  if (!read) throw new Error(`\`${version}\` is not a version like \`1.2.3\` or \`1.2.3-beta.1\``);
  return read;
}
