import type { Ref } from '../../utils/reactive/ref.ts';
import type { Child } from '../render/insert.ts';

import { computed } from '../../utils/reactive/computed.ts';
import { css } from '../render/css.ts';
import { h } from '../render/h.ts';
import { icon } from './icon.ts';
import { numberInput } from './number-input.ts';
import { paginationPages } from './pagination-pages.ts';
import './tokens.ts';

/**
 * Options for `pagination`.
 */
export interface PaginationOptions {
  /**
   * The current page number, read reactively.
   */
  currentPage: () => number;

  /**
   * The last page number, read reactively.
   */
  lastPage: () => number;

  /**
   * The text to display in the `title` attribute of the previous button.
   *
   * @default
   * 'Previous'
   */
  previousPageTitle?: string;

  /**
   * The text to display in the `title` attribute of the next button.
   *
   * @default
   * 'Next'
   */
  nextPageTitle?: string;

  /**
   * The text to display in the `title` attribute of the page number buttons.
   * The page number follows it.
   *
   * @default
   * 'Go to page'
   */
  goToPageTitle?: string;

  /**
   * Size step of the component: -2 very small, -1 small, 0 default, 1 large, 2 very large.
   * Omitted inherits `--ohne-size` from the nearest ancestor.
   */
  size?: number;

  /**
   * Called with the requested page; the component never owns the page state.
   */
  onChange?: (page: number) => void;

  /**
   * Renders one page number button in place of the default; not the ellipsis or the chevrons.
   * `onClick` guards the current page before reporting the change.
   */
  button?: (payload: {
    currentPage: number;
    index: number;
    lastPage: number;
    onClick: () => void;
  }) => Child;
}

css`
  .ohne-pagination-buttons {
    display: flex;
    overflow-x: auto;
    scrollbar-width: thin;
    scrollbar-color: hsl(var(--ohne-foreground) / 0.25) transparent;
  }

  .ohne-pagination-button {
    flex-shrink: 0;
    position: relative;
    display: inline-flex;
    justify-content: center;
    align-items: center;
    min-width: calc(2em + 0.25rem);
    height: calc(2em + 0.25rem);
    padding: 0 0.75em;
    padding: 0 round(0.75em, 1px);
    overflow: hidden;
    background-color: hsl(var(--ohne-background));
    border: 1px solid hsl(var(--ohne-input));
    color: hsl(var(--ohne-muted-foreground));
    font-size: calc(1rem + var(--ohne-size) * 0.125rem);
    line-height: 1.5;
    white-space: nowrap;
    transition: var(--ohne-transition);
    transition-property: background-color, border-color, color;
  }

  .ohne-pagination-button:first-child {
    padding: 0;
    border-top-left-radius: calc(var(--ohne-radius) - 0.125rem);
    border-bottom-left-radius: calc(var(--ohne-radius) - 0.125rem);
  }

  .ohne-pagination-button:last-child {
    padding: 0;
    border-top-right-radius: calc(var(--ohne-radius) - 0.125rem);
    border-bottom-right-radius: calc(var(--ohne-radius) - 0.125rem);
  }

  .ohne-pagination-button:not(:first-child) {
    margin-left: -1px;
  }

  .ohne-pagination-button:disabled {
    pointer-events: none;
    color: hsl(var(--ohne-muted-foreground) / 0.64);
  }

  .ohne-pagination-button:not(.ohne-pagination-ellipsis):not(.ohne-pagination-button-active):hover {
    background-color: hsl(var(--ohne-secondary));
    color: hsl(var(--ohne-secondary-foreground));
  }

  .ohne-pagination-button-active {
    border-color: hsl(var(--ohne-accent));
    background-color: hsl(var(--ohne-accent));
    color: hsl(var(--ohne-accent-foreground));
    font-weight: 500;
  }

  .ohne-pagination-button-active + .ohne-pagination-button {
    border-left-color: hsl(var(--ohne-accent));
  }

  .ohne-pagination-button:focus-visible {
    z-index: 1;
    box-shadow:
      0 0 0 0.125rem hsl(var(--ohne-background)),
      0 0 0 0.25rem hsl(var(--ohne-ring)),
      0 0 #0000;
    outline: 0.125rem solid transparent;
    outline-offset: 0.125rem;
  }

  .ohne-pagination-button > svg {
    flex-shrink: 0;
    font-size: calc(1em + 0.25rem);
  }

  .ohne-pagination-combo {
    display: none;
    align-items: center;
  }

  .ohne-pagination-combo .ohne-number {
    z-index: 1;
    margin-left: -1px;
    background-color: transparent;
    border-radius: 0;
  }

  .ohne-pagination-combo .ohne-number-input {
    padding: 0 1em;
  }

  .ohne-pagination-combo > :focus {
    z-index: 2;
  }

  @container (max-width: 767px) {
    .ohne-pagination-buttons {
      display: none;
    }

    .ohne-pagination-combo {
      display: flex;
    }
  }
`;

/**
 * Numbered pagination: an ellipsis-windowed button row.
 * A prev / number-input / next combo replaces it below 767px container width.
 * The component never owns the page state - every interaction reports through `onChange`.
 * A single page hides the whole component.
 * The responsive switch is a container query, firing only inside a `container-type: inline-size` ancestor.
 * Without one the combo never appears.
 *
 * @example
 * ```ts
 * pagination({
 *   currentPage: () => page.value,
 *   lastPage: () => pageCount.value,
 *   onChange: (page) => load(page),
 * })
 * ```
 */
export function pagination(options: PaginationOptions): HTMLElement {
  const pages = computed(() => paginationPages(options.currentPage(), options.lastPage()));
  const previousTitle = options.previousPageTitle ?? 'Previous';
  const nextTitle = options.nextPageTitle ?? 'Next';
  const goToTitle = options.goToPageTitle ?? 'Go to page';
  const change = (page: number): void => options.onChange?.(page);

  const previousButton = (): HTMLElement =>
    h(
      'button',
      {
        disabled: () => options.currentPage() === 1,
        title: previousTitle,
        type: 'button',
        class: 'ohne-pagination-button ohne-raw',
        onClick: () => change(options.currentPage() - 1),
      },
      icon('chevron-left'),
    );

  const nextButton = (): HTMLElement =>
    h(
      'button',
      {
        disabled: () => options.currentPage() === options.lastPage(),
        title: nextTitle,
        class: 'ohne-pagination-button ohne-raw',
        onClick: () => change(options.currentPage() + 1),
      },
      icon('chevron-right'),
    );

  const pageModel: Ref<number> = {
    get value() {
      return options.currentPage();
    },
    set value(next) {
      change(next);
    },
  };

  return h(
    'div',
    {
      hidden: () => (pages.value.length > 1 ? null : true),
      class: 'ohne-pagination',
      style: options.size === undefined ? undefined : `--ohne-size: ${options.size}`,
    },
    h(
      'div',
      { class: 'ohne-pagination-buttons' },
      previousButton(),
      () =>
        pages.value.map((entry) => {
          if (entry === '...') {
            return h('span', { class: 'ohne-pagination-button ohne-pagination-ellipsis' }, '...');
          }
          const onClick = (): void => {
            if (options.currentPage() !== entry) change(entry);
          };
          return options.button
            ? options.button({
                currentPage: options.currentPage(),
                index: entry,
                lastPage: options.lastPage(),
                onClick,
              })
            : h(
                'button',
                {
                  title: `${goToTitle} ${entry}`,
                  type: 'button',
                  class:
                    'ohne-pagination-button ohne-raw' +
                    (options.currentPage() === entry ? ' ohne-pagination-button-active' : ''),
                  onClick,
                },
                entry,
              );
        }),
      nextButton(),
    ),
    h(
      'div',
      { class: 'ohne-pagination-combo' },
      previousButton(),
      // numberInput takes static bounds, so the input rebuilds when the page count changes.
      () =>
        numberInput(pageModel, {
          min: 1,
          max: options.lastPage(),
          autoWidth: true,
          name: 'ohne-pagination',
        }),
      nextButton(),
    ),
  );
}
