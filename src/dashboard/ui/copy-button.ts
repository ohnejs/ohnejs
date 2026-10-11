import { isUndefined } from '../../utils/is/is-undefined.ts';
import { onCleanup } from '../../utils/reactive/effect-scope.ts';
import { ref } from '../../utils/reactive/ref.ts';
import { type MaybeGetter, toValue } from '../../utils/reactive/to-value.ts';
import { defaultText, resolveText, type Text } from '../runtime/text.ts';
import { button } from './button.ts';
import { icon } from './icon.ts';
import { attachTooltip } from './tooltip.ts';
import './tokens.ts';

/**
 * Options for `copyButton`.
 */
export interface CopyButtonOptions {
  /**
   * The accessible name and the resting tooltip.
   *
   * @default
   * 'dashboard.copy'
   */
  label?: Text;

  /**
   * Size step of the component: -2 very small, -1 small, 0 default, 1 large, 2 very large.
   * Omitted inherits `--ohne-size` from the nearest ancestor.
   */
  size?: number;
}

/**
 * A ghost icon button that copies `text` to the clipboard.
 * After a copy its icon turns into a check and its tooltip says so for 1.5s; a failure says that instead.
 *
 * @example
 * ```ts
 * copyButton(() => guild.value.inviteCode, { label: 'Copy invite code' })
 * ```
 */
export function copyButton(
  text: MaybeGetter<string>,
  options: CopyButtonOptions = {},
): HTMLElement {
  const { label } = options;
  const outcome = ref<'copied' | 'failed' | undefined>(undefined);
  let timer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(timer));

  const settle = (next: 'copied' | 'failed'): void => {
    clearTimeout(timer);
    outcome.value = next;
    timer = setTimeout(() => {
      outcome.value = undefined;
    }, 1500);
  };

  const name = (): string =>
    isUndefined(label) ? defaultText('dashboard.copy', 'Copy') : resolveText(label);
  const el = button(() => icon(outcome.value === 'copied' ? 'check' : 'copy'), {
    variant: 'ghost',
    size: options.size,
    ariaLabel: name,
    onClick: () => {
      const clipboard = navigator.clipboard as Clipboard | undefined;
      if (isUndefined(clipboard)) return settle('failed');
      void clipboard.writeText(toValue(text)).then(
        () => settle('copied'),
        () => settle('failed'),
      );
    },
  });
  onCleanup(
    attachTooltip(
      el,
      () =>
        outcome.value === 'copied'
          ? defaultText('dashboard.copied', 'Copied')
          : outcome.value === 'failed'
            ? defaultText('dashboard.copyFailed', 'Copy failed')
            : name(),
      { hideOnClick: false },
    ),
  );
  return el;
}
