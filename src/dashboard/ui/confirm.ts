import { isUndefined } from '../../utils/is/is-undefined.ts';
import { defaultText, resolveText, type Text } from '../runtime/text.ts';
import { openDialog } from './dialog.ts';

/**
 * Options for `confirm`.
 */
export interface ConfirmOptions {
  /**
   * The question, shown in bold.
   */
  title: Text;

  /**
   * What happens if the reader agrees, under the title.
   */
  body?: Text;

  /**
   * The label of the button that agrees.
   */
  action: Text;

  /**
   * Paints the agreeing button destructive, for an action that cannot be undone.
   *
   * @default
   * false
   */
  destructive?: boolean;
}

/**
 * Asks the reader to confirm an action in the global dialog.
 * Resolves `true` when they agree, and `false` on cancel, Escape, or a click outside.
 * The title and body speak markdown-lite, so backticked values highlight.
 *
 * @example
 * ```ts
 * if (await confirm({ title: 'Disband `Horde Vanguard`?', action: 'Disband', destructive: true })) {
 *   await disband()
 * }
 * ```
 */
export async function confirm(options: ConfirmOptions): Promise<boolean> {
  const { body, title } = options;
  const picked = await openDialog({
    content: () =>
      `**${resolveText(title)}**` + (isUndefined(body) ? '' : `\n\n${resolveText(body)}`),
    actions: [
      { name: 'cancel', label: () => defaultText('dashboard.cancel', 'Cancel') },
      {
        name: 'confirm',
        label: () => resolveText(options.action),
        variant: options.destructive ? 'destructive' : 'primary',
      },
    ],
  });
  return picked === 'confirm';
}
