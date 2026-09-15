import { css } from '../../render/css.ts';

/**
 * The tooltip theme.
 * The arrow is a CSS border triangle that inherits currentColor, so it recolors per theme.
 * Tooltips sit one step smaller than everything else.
 */
css`
  .ohne-tooltip[data-animation='fade'][data-state='hidden'] {
    opacity: 0;
  }

  .ohne-tooltip-root {
    max-width: calc(100vw - 0.625rem);
  }

  .ohne-tooltip {
    position: relative;
    background-color: hsl(var(--ohne-primary));
    border-radius: var(--ohne-radius);
    outline: 0;
    filter: drop-shadow(0 0.25rem 0.25rem rgb(0 0 0 / 0.12));
    color: hsl(var(--ohne-primary-foreground));
    font-size: calc(0.875rem + var(--ohne-tooltip-size) * 0.125rem);
    white-space: normal;
    transition-property: transform, visibility, opacity;
  }

  .ohne-tooltip[data-theme='destructive'] {
    background-color: hsl(var(--ohne-destructive));
    color: hsl(var(--ohne-destructive-foreground));
  }

  .ohne-tooltip[data-placement^='top'] > .ohne-tooltip-arrow {
    bottom: 0;
  }

  .ohne-tooltip[data-placement^='top'] > .ohne-tooltip-arrow:before {
    bottom: -0.4375em;
    left: 0;
    border-width: 0.5em 0.5em 0;
    border-top-color: initial;
    transform-origin: center top;
  }

  .ohne-tooltip[data-placement^='bottom'] > .ohne-tooltip-arrow {
    top: 0;
  }

  .ohne-tooltip[data-placement^='bottom'] > .ohne-tooltip-arrow:before {
    top: -0.4375em;
    left: 0;
    border-width: 0 0.5em 0.5em;
    border-bottom-color: initial;
    transform-origin: center bottom;
  }

  .ohne-tooltip[data-placement^='left'] > .ohne-tooltip-arrow {
    right: 0;
  }

  .ohne-tooltip[data-placement^='left'] > .ohne-tooltip-arrow:before {
    border-width: 0.5em 0 0.5em 0.5em;
    border-left-color: initial;
    right: -0.4375rem;
    transform-origin: center left;
  }

  .ohne-tooltip[data-placement^='right'] > .ohne-tooltip-arrow {
    left: 0;
  }

  .ohne-tooltip[data-placement^='right'] > .ohne-tooltip-arrow:before {
    left: -0.4375em;
    border-width: 0.5em 0.5em 0.5em 0;
    border-right-color: initial;
    transform-origin: center right;
  }

  .ohne-tooltip[data-inertia][data-state='visible'] {
    transition-timing-function: cubic-bezier(0.54, 1.5, 0.38, 1.11);
  }

  .ohne-tooltip-arrow {
    width: 1em;
    height: 1em;
    color: hsl(var(--ohne-primary));
  }

  .ohne-tooltip[data-theme='destructive'] .ohne-tooltip-arrow {
    color: hsl(var(--ohne-destructive));
  }

  .ohne-tooltip-arrow:before {
    content: '';
    position: absolute;
    border-color: transparent;
    border-style: solid;
  }

  .ohne-tooltip-content {
    position: relative;
    z-index: 1;
    padding: 0.5em 0.75em;
  }

  .ohne-tooltip pre > code {
    font-size: 0.875em;
    font-weight: 500;
    font-style: normal;
  }

  .ohne-tooltip :not(pre) > code {
    padding: 0.25em 0.5em;
    background-color: hsl(var(--ohne-accent) / 0.2);
    border-radius: 0.5em;
    font-size: 0.875em;
    font-weight: 500;
    font-style: normal;
  }
`;
