import { parsed } from './_parsed.ts';

/**
 * The first version of the line after `version`, where a breaking change may land.
 * Before 1.0 that is the next minor, from 1.0 on the next major.
 * A string that is not a version throws.
 *
 * @example
 * ```ts
 * nextVersionLine('0.1.4')        // -> '0.2.0'
 * nextVersionLine('0.9.0-beta.1') // -> '0.10.0'
 * nextVersionLine('2.7.3')        // -> '3.0.0'
 * ```
 */
export function nextVersionLine(version: string): string {
  const { major, minor } = parsed(version);
  return major === 0 ? `0.${minor + 1}.0` : `${major + 1}.0.0`;
}
