import { css, h, icon, textInput, useT } from 'ohnejs/dashboard';
import { effect, type Ref } from 'ohnejs/utils';

/**
 * Options for `searchInput`.
 */
export interface SearchInputOptions {
  /**
   * The placeholder, read reactively.
   */
  placeholder: () => string;

  /**
   * The accessible name of the input, read reactively.
   */
  label: () => string;

  /**
   * Size step of the component: -2 very small, -1 small, 0 default, 1 large, 2 very large.
   * Omitted inherits `--ohne-size` from the nearest ancestor.
   */
  size?: number;

  /**
   * The `autofocus` attribute of the input, which a popup focuses on mount.
   *
   * @default
   * false
   */
  autofocus?: boolean;
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
  .o-search-input .o-search-input-icon {
    margin-left: 0.75rem;
    margin-right: 0;
    color: hsl(var(--ohne-muted-foreground));
    font-size: 1rem;
  }

  .o-search-input .o-search-input-clear {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    margin-right: 0.375rem;
    margin-left: 0;
    padding: 0.1875rem;
    border-width: 1px;
    border-color: transparent;
    border-radius: calc(var(--ohne-radius) - 0.25rem);
    outline: none;
    background-color: transparent;
    color: hsl(var(--ohne-muted-foreground));
    font-size: 0.75rem;
    line-height: 1;
  }

  .o-search-input .o-search-input-clear:hover {
    background-color: hsl(var(--ohne-muted) / 0.6);
    color: hsl(var(--ohne-foreground));
  }

  .o-search-input .o-search-input-clear:focus-visible {
    border-color: hsl(var(--ohne-ring));
    color: hsl(var(--ohne-foreground));
  }
`;

/**
 * A search box: a magnifier before the text and, while there is text, a clear button after it.
 * Clearing empties `query` and focuses the input again, so typing goes on.
 */
export function searchInput(query: Ref<string>, options: SearchInputOptions): SearchInput {
  const t = useT();
  const magnifier = icon('search');
  magnifier.classList.add('o-search-input-icon');
  const clear = (): void => {
    query.value = '';
    input.focus();
  };
  const box = textInput(query, {
    size: options.size,
    autofocus: options.autofocus,
    placeholder: options.placeholder,
    prefix: magnifier,
    suffix: () =>
      query.value === ''
        ? null
        : h(
            'button',
            {
              type: 'button',
              class: 'o-search-input-clear ohne-raw',
              'aria-label': () => t('dashboard.clearSearch'),
              title: () => t('dashboard.clearSearch'),
              onClick: clear,
            },
            icon('x'),
          ),
  });
  box.classList.add('o-search-input');
  const input = box.querySelector('input')!;
  effect(() => input.setAttribute('aria-label', options.label()));
  return { box, input, clear };
}
