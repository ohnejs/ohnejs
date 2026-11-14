import type { Ref } from '../../utils/reactive/ref.ts';
import type { Child } from '../render/insert.ts';

import { isUndefined } from '../../utils/is/is-undefined.ts';
import { onCleanup } from '../../utils/reactive/effect-scope.ts';
import { effect } from '../../utils/reactive/effect.ts';
import { css } from '../render/css.ts';
import { h } from '../render/h.ts';
import { when } from '../render/when.ts';
import { defaultText, resolveText, type Text } from '../runtime/text.ts';
import { icon } from './icon.ts';
import { textInput } from './text-input.ts';
import { attachTooltip } from './tooltip.ts';
import './tokens.ts';

/**
 * Options for `searchInput`.
 */
export interface SearchInputOptions {
  /**
   * The placeholder.
   *
   * @default
   * 'dashboard.search'
   */
  placeholder?: Text;

  /**
   * The accessible name of the input.
   *
   * @default
   * 'dashboard.search'
   */
  label?: Text;

  /**
   * Size step of the component: -2 very small, -1 small, 0 default, 1 large, 2 very large.
   * Omitted inherits `--ohne-size` from the nearest ancestor.
   */
  size?: number;

  /**
   * Disables the input reactively while it returns `true`.
   */
  disabled?: () => boolean;

  /**
   * The `autofocus` attribute of the input, which a popup focuses on mount.
   *
   * @default
   * false
   */
  autofocus?: boolean;

  /**
   * Controls set before the clear button, read reactively.
   */
  actions?: () => Child;
}

/**
 * A mounted search input.
 */
export interface SearchInput {
  /**
   * The bordered box: the magnifier, the input and the clear button.
   */
  box: HTMLElement;

  /**
   * The input element.
   */
  input: HTMLInputElement;

  /**
   * Empties the query and focuses the input.
   */
  clear(): void;
}

css`
  .ohne-search-input .ohne-search-input-icon {
    margin-right: 0;
    margin-left: 0.75rem;
    color: hsl(var(--ohne-muted-foreground));
    font-size: 1rem;
  }

  .ohne-search-input .ohne-search-input-clear {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    margin-right: 0.375rem;
    margin-left: 0;
    padding: 0.25rem;
    border-radius: calc(var(--ohne-radius) - 0.25rem);
    outline: none;
    background-color: transparent;
    color: hsl(var(--ohne-muted-foreground));
    font-size: 0.75rem;
    line-height: 1;
  }

  @media (hover: hover) {
    .ohne-search-input .ohne-search-input-clear:hover {
      background-color: hsl(var(--ohne-muted) / 0.6);
      color: hsl(var(--ohne-foreground));
    }
  }

  .ohne-search-input .ohne-search-input-clear:focus-visible {
    box-shadow: inset 0 0 0 0.125rem hsl(var(--ohne-ring));
    color: hsl(var(--ohne-foreground));
  }
`;

/**
 * A search box: a magnifier before the text, then any `actions` and, while there is text, a clear button.
 * Clearing empties `query` and focuses the input again, so typing goes on.
 *
 * @example
 * ```ts
 * const query = ref('')
 * searchInput(query, { placeholder: 'Search designs' }).box
 * ```
 */
export function searchInput(query: Ref<string>, options: SearchInputOptions = {}): SearchInput {
  const text = (value: Text | undefined): string =>
    isUndefined(value) ? defaultText('dashboard.search', 'Search') : resolveText(value);
  const clearLabel = (): string => defaultText('dashboard.clearSearch', 'Clear search');
  const magnifier = icon('search');
  magnifier.classList.add('ohne-search-input-icon');
  const clear = (): void => {
    query.value = '';
    input.focus();
  };
  const box = textInput(query, {
    size: options.size,
    autofocus: options.autofocus,
    disabled: options.disabled,
    placeholder: () => text(options.placeholder),
    prefix: magnifier,
    suffix: [
      () => options.actions?.() ?? null,
      when(
        () => query.value !== '' && options.disabled?.() !== true,
        () => {
          const button = h(
            'button',
            {
              type: 'button',
              class: 'ohne-search-input-clear ohne-raw',
              'aria-label': clearLabel,
              onClick: clear,
            },
            icon('x'),
          );
          onCleanup(attachTooltip(button, clearLabel));
          return button;
        },
      ),
    ],
  });
  box.classList.add('ohne-search-input');
  const input = box.querySelector('input')!;
  effect(() => input.setAttribute('aria-label', text(options.label)));
  return { box, input, clear };
}
