import { isEmpty } from '../is/is-empty.ts';
import { isPadded } from './_padded.ts';
import { escapeControls } from './escape-controls.ts';

/**
 * Wraps `value` in a backtick span that `applyANSIMarkup` prints exactly, whatever it holds.
 * Control characters, line breaks included, print as escapes, so the span stays on one line.
 * The fence is the shortest backtick run the value does not contain.
 * A space pads each side when the value touches a backtick, or would lose its own edge spaces.
 * An empty value stays empty, since no span holds nothing.
 *
 * @example
 * ```ts
 * codeSpan('a.txt')     // -> '`a.txt`'
 * codeSpan('a`b`c.txt') // -> '``a`b`c.txt``'
 * codeSpan('`x')        // -> '`` `x ``'
 * codeSpan('a\nb')      // -> '`a\\nb`'
 * ```
 */
export function codeSpan(value: string): string {
  const shown = escapeControls(value);
  if (isEmpty(shown)) return shown;
  const runs = new Set(shown.match(/`+/g)?.map((run) => run.length));
  let length = 1;
  while (runs.has(length)) length++;
  const fence = '`'.repeat(length);
  const pad = /^`|`$/.test(shown) || isPadded(shown) ? ' ' : '';
  return `${fence}${pad}${shown}${pad}${fence}`;
}
