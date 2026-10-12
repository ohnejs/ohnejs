import type { Version } from './version.ts';

const IDENTIFIER = String.raw`(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)`;

const VERSION = new RegExp(
  String.raw`^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(${IDENTIFIER}(?:\.${IDENTIFIER})*))?$`,
);

/**
 * Reads a plain `x.y.z[-pre]` version into its numbers and prerelease identifiers.
 * Returns `undefined` for anything else: a `v` prefix, a range, build metadata, a number with a leading zero.
 *
 * @example
 * ```ts
 * parseVersion('1.2.3')        // -> { major: 1, minor: 2, patch: 3, prerelease: [] }
 * parseVersion('1.0.0-beta.1') // -> { major: 1, minor: 0, patch: 0, prerelease: ['beta', '1'] }
 * parseVersion('v1.2.3')       // -> undefined
 * parseVersion('^1.2.3')       // -> undefined
 * ```
 */
export function parseVersion(version: string): Version | undefined {
  const match = VERSION.exec(version);
  if (!match) return undefined;
  const [, major, minor, patch, prerelease] = match;
  return {
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
    prerelease: prerelease ? prerelease.split('.') : [],
  };
}
