import { parsed } from './_parsed.ts';

/**
 * Whether a version carries prerelease identifiers, like `1.0.0-beta.1`.
 * A string that is not a version throws.
 *
 * @example
 * ```ts
 * isPrerelease('1.0.0-beta.1') // -> true
 * isPrerelease('1.0.0')        // -> false
 * ```
 */
export function isPrerelease(version: string): boolean {
  return parsed(version).prerelease.length > 0;
}
