import type { PeerRange } from './peer-range.ts';

import { isUndefined } from '../is/is-undefined.ts';
import { nextVersionLine } from './next-version-line.ts';
import { parseVersion } from './parse-version.ts';

const RANGE = /^>=\s*(\S+?)(?:\s+<\s*(\S+?)(?:-0)?)?$/;

/**
 * Reads a peer range in a shape ohne packages publish: `>=a <b-0`, a lone `>=a`, or an exact version.
 * A lone `>=a` ends at `a`'s line, since the next line may break it.
 * Returns `undefined` for any other shape, `^`, `~`, `*` and `||` included, so nothing is guessed.
 *
 * @example
 * ```ts
 * parsePeerRange('>=0.1.0 <0.2.0-0') // -> { floor: '0.1.0', ceiling: '0.2.0', exact: false }
 * parsePeerRange('>=0.1.0')          // -> { floor: '0.1.0', ceiling: '0.2.0', exact: false }
 * parsePeerRange('0.2.0-beta.1')     // -> { floor: '0.2.0-beta.1', ceiling: '0.2.0-beta.1', exact: true }
 * parsePeerRange('^0.1.0')           // -> undefined
 * ```
 */
export function parsePeerRange(range: string): PeerRange | undefined {
  const trimmed = range.trim();
  const match = RANGE.exec(trimmed);
  if (!match)
    return parseVersion(trimmed) ? { floor: trimmed, ceiling: trimmed, exact: true } : undefined;
  const [, floor = '', ceiling] = match;
  if (!parseVersion(floor) || (!isUndefined(ceiling) && !parseVersion(ceiling))) return undefined;
  return { floor, ceiling: ceiling ?? nextVersionLine(floor), exact: false };
}
