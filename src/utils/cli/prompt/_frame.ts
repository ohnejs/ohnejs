import type { ANSIColors } from '../../ansi/pick-ansi-colors.ts';
import type { PromptState } from './_prompt.ts';

import { applyANSIMarkup } from '../../ansi/apply-ansi-markup.ts';
import { pickANSIColors } from '../../ansi/pick-ansi-colors.ts';
import { isUndefined } from '../../is/is-undefined.ts';

const PLAIN = pickANSIColors(false);

/**
 * The glyph that leads a prompt, chosen by status.
 * A pending error reds the active diamond; submit turns it green, cancel a red square.
 *
 * @example
 * ```ts
 * statusSymbol('active', undefined, colors)  // -> cyan '◆'
 * statusSymbol('submit', undefined, colors)  // -> green '◇'
 * statusSymbol('active', 'Required', colors) // -> red '◆'
 * ```
 */
export function statusSymbol(
  status: PromptState<unknown>['status'],
  error: string | undefined,
  colors: ANSIColors,
): string {
  if (status === 'submit') return colors.green('◇');
  if (status === 'cancel') return colors.red('■');
  if (!isUndefined(error)) return colors.red('◆');
  return colors.cyan('◆');
}

/**
 * The question line: the status glyph then the message, with inline markup applied.
 * While active and valid the message is cyan with its markup styled.
 * Under an error it is flat red: the markup is flattened to plain text so the whole line is one red.
 * Once resolved it renders untinted.
 *
 * @example
 * ```ts
 * titleLine('Name?', 'active', undefined, colors) // -> cyan '◆  Name?'
 * titleLine('Name?', 'submit', undefined, colors) // -> green '◇  Name?'
 * ```
 */
export function titleLine(
  message: string,
  status: PromptState<unknown>['status'],
  error: string | undefined,
  colors: ANSIColors,
): string {
  const symbol = statusSymbol(status, error, colors);
  if (status !== 'active') return `${symbol}  ${applyANSIMarkup(message, false, colors)}`;
  if (!isUndefined(error))
    return `${symbol}  ${colors.red(applyANSIMarkup(message, false, PLAIN))}`;
  return `${symbol}  ${colors.cyan(applyANSIMarkup(message, true, colors))}`;
}

/**
 * Prepends the connecting rail when a prompt follows another in a flow.
 * The first prompt stands alone; every later one is joined by a dim `│`.
 *
 * @example
 * ```ts
 * leadIn('◆  Name?', false, colors) // -> '◆  Name?'
 * leadIn('◆  Name?', true, colors)  // -> '│\n◆  Name?'
 * ```
 */
export function leadIn(block: string, lead: boolean, colors: ANSIColors): string {
  return lead ? `${colors.dim('│')}\n${block}` : block;
}
