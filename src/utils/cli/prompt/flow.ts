import type { ANSIColors } from '../../ansi/pick-ansi-colors.ts';

import { applyANSIMarkup } from '../../ansi/apply-ansi-markup.ts';
import { leadIn } from './_frame.ts';

const SGR = new RegExp(`${'\x1b'}\\[[0-9;]*m`, 'g');

/**
 * The opening line of a flow: a top corner and the title, with inline markup applied.
 * The first thing printed, so it carries no connecting rail.
 *
 * @example
 * ```ts
 * introLine('My App', colors, false) // -> dim '┌' + '  My App'
 * ```
 */
export function introLine(title: string, colors: ANSIColors, lead: boolean): string {
  return leadIn(`${colors.dim('┌')}  ${applyANSIMarkup(title, false, colors)}`, lead, colors);
}

/**
 * The closing block of a flow: a spacer rail then a bottom corner and the message.
 * Joins to whatever came before, so it leads with the rail.
 *
 * @example
 * ```ts
 * outroBlock('Done', colors, true) // -> '│\n' + dim '└' + '  Done'
 * ```
 */
export function outroBlock(message: string, colors: ANSIColors, lead: boolean): string {
  const close = `${colors.dim('└')}  ${applyANSIMarkup(message, false, colors)}`;
  return leadIn(close, lead, colors);
}

/**
 * A boxed aside drawn off the rail, used to surface information between prompts.
 * The title sits on the top edge; each message line is framed and right-aligned to a shared border.
 *
 * @example
 * ```ts
 * noteBlock('Run `pnpm dev`', 'Next', colors, true)
 * // -> a green '◇  Next' header, the body line framed, and a '├──╯' base
 * ```
 */
export function noteBlock(
  message: string,
  title: string,
  colors: ANSIColors,
  lead: boolean,
  last: boolean = false,
): string {
  const lines = `\n${message}\n`.split('\n').map((line) => applyANSIMarkup(line, false, colors));
  const renderedTitle = applyANSIMarkup(title, false, colors);
  const titleWidth = visibleWidth(renderedTitle);
  const inner = Math.max(titleWidth, ...lines.map(visibleWidth)) + 2;

  const top = `${colors.green('◇')}  ${renderedTitle} ${colors.dim('─'.repeat(Math.max(inner - titleWidth - 1, 1)) + '╮')}`;
  const body = lines
    .map((line) => {
      const pad = ' '.repeat(inner - visibleWidth(line));
      return `${colors.dim('│')}  ${line}${pad}${colors.dim('│')}`;
    })
    .join('\n');
  const base = colors.dim(`${last ? '└' : '├'}${'─'.repeat(inner + 2)}╯`);
  return leadIn(`${top}\n${body}\n${base}`, lead, colors);
}

function visibleWidth(text: string): number {
  return [...text.replace(SGR, '')].length;
}
