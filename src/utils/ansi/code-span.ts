import { isEmpty } from '../is/is-empty.ts';
import { isPadded } from './_padded.ts';
import { escapeControls } from './escape-controls.ts';

/**
 * Wraps `value` in a backtick span that `applyANSIMarkup` prints exactly, whatever it holds.
 * Control characters, line breaks included, print as escapes, so the span stays on one line.
 * The fence is the shortest backtick run of at least `minimum` that the value does not contain.
 * A space pads each side when the value touches a backtick, or would lose its own edge spaces.
 * An empty value spans one space, so it still shows.
 *
 * @example
 * ```ts
 * codeSpan('a.txt')     // -> '`a.txt`'
 * codeSpan('a`b`c.txt') // -> '``a`b`c.txt``'
 * codeSpan('`x')        // -> '`` `x ``'
 * codeSpan('a\nb')      // -> '`a\\nb`'
 * codeSpan('')          // -> '` `'
 * codeSpan('a', 2)      // -> '``a``'
 * ```
 */
export function codeSpan(value: string, minimum = 1): string {
  const shown = escapeControls(value);
  const runs = new Set(shown.match(/`+/g)?.map((run) => run.length));
  let length = minimum;
  while (runs.has(length)) length++;
  const fence = '`'.repeat(length);
  if (isEmpty(shown)) return `${fence} ${fence}`;
  const pad = /^`|`$/.test(shown) || isPadded(shown) ? ' ' : '';
  return `${fence}${pad}${shown}${pad}${fence}`;
}
