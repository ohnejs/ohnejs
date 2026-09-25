import { isEmpty } from '../is/is-empty.ts';
import { isPadded } from './_padded.ts';

/**
 * Wraps a one-line `value` in a backtick span that `applyANSIMarkup` prints exactly, whatever it holds.
 * The fence is the shortest backtick run the value does not contain.
 * A space pads each side when the value touches a backtick, or would lose its own edge spaces.
 * An empty value stays empty, since no span holds nothing.
 *
 * @example
 * ```ts
 * codeSpan('a.txt')     // -> '`a.txt`'
 * codeSpan('a`b`c.txt') // -> '``a`b`c.txt``'
 * codeSpan('`x')        // -> '`` `x ``'
 * ```
 */
export function codeSpan(value: string): string {
  if (isEmpty(value)) return value;
  const runs = new Set(value.match(/`+/g)?.map((run) => run.length));
  let length = 1;
  while (runs.has(length)) length++;
  const fence = '`'.repeat(length);
  const pad = /^`|`$/.test(value) || isPadded(value) ? ' ' : '';
  return `${fence}${pad}${value}${pad}${fence}`;
}
