import { css, h, hotkeyLabels, icon, isMac, useT } from 'ohnejs/dashboard';

import { openPalette } from './palette-state.ts';

css`
  .o-header-search {
    display: inline-flex;
    align-items: center;
    gap: 0.5em;
    width: 15rem;
    max-width: 100%;
    height: calc(2em + 0.25rem);
    padding: 0 0.625em;
    background-color: hsl(var(--ohne-background));
    border: 1px solid hsl(var(--ohne-input));
    border-radius: calc(var(--ohne-radius) - 0.125rem);
    color: hsl(var(--ohne-muted-foreground));
    font-size: calc(1rem + var(--ohne-size) * 0.125rem);
    text-align: left;
    transition: var(--ohne-transition);
    transition-property: background-color, border-color, box-shadow, color;
  }

  .o-header-search:hover {
    background-color: hsl(var(--ohne-accent));
    border-color: hsl(var(--ohne-accent));
    color: hsl(var(--ohne-accent-foreground));
  }

  .o-header-search:focus-visible {
    box-shadow:
      0 0 0 0.125rem hsl(var(--ohne-background)),
      0 0 0 0.25rem hsl(var(--ohne-ring));
    outline: none;
  }

  .o-header-search > svg {
    flex-shrink: 0;
    font-size: calc(1em + 0.25rem);
  }

  .o-header-search > span {
    flex: 1;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .o-header-search > kbd {
    flex-shrink: 0;
    display: flex;
    gap: 0.25em;
    font-family: var(--ohne-font);
    font-size: calc(1em - 0.1875rem);
    line-height: calc(1em + 0.375rem);
  }

  .o-header-search > kbd > span {
    padding: 0 0.375em;
    border: 1px solid hsl(var(--ohne-border));
    border-radius: calc(var(--ohne-radius) - 0.25rem);
  }

  @media (max-width: 767px) {
    .o-header-search {
      justify-content: center;
      width: calc(2em + 0.25rem);
      padding: 0;
    }

    .o-header-search > span,
    .o-header-search > kbd {
      display: none;
    }
  }
`;

/**
 * The header's search box: a button in the shape of an input that opens the palette.
 * It shows the magnifier, the placeholder and the palette's hotkey; under `768px` only the magnifier.
 */
export function headerSearch(): HTMLElement {
  const t = useT();
  const keys = hotkeyLabels(isMac()).search.split(' + ');
  return h(
    'button',
    {
      type: 'button',
      class: 'o-header-search ohne-raw',
      'aria-label': () => t('dashboard.palette.label'),
      title: () => t('dashboard.palette.label'),
      onClick: () => openPalette(),
    },
    icon('search'),
    h('span', null, () => t('dashboard.searchPlaceholder')),
    h(
      'kbd',
      null,
      keys.map((key) => h('span', null, key)),
    ),
  );
}
