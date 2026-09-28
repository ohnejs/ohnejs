import type { ANSIColors } from '../../ansi/pick-ansi-colors.ts';

import { applyANSIMarkup } from '../../ansi/apply-ansi-markup.ts';
import { terminalWidth } from '../../ansi/terminal-width.ts';
import { leadIn } from './_frame.ts';

/**
 * The opening line of a flow: a top corner and the title, with inline markup applied.
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
 * The closing line of a flow: a bottom corner and the message, with inline markup applied.
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
  const titleWidth = terminalWidth(renderedTitle);
  const inner = Math.max(titleWidth, ...lines.map(terminalWidth)) + 2;

  const top = `${colors.green('◇')}  ${renderedTitle} ${colors.dim('─'.repeat(Math.max(inner - titleWidth - 1, 1)) + '╮')}`;
  const body = lines
    .map((line) => {
      const pad = ' '.repeat(inner - terminalWidth(line));
      return `${colors.dim('│')}  ${line}${pad}${colors.dim('│')}`;
    })
    .join('\n');
  const base = colors.dim(`${last ? '└' : '├'}${'─'.repeat(inner + 2)}╯`);
  return leadIn(`${top}\n${body}\n${base}`, lead, colors);
}
