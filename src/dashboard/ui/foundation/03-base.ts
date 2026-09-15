import { css } from '../../render/css.ts';

/**
 * The base reset and element defaults.
 *
 * Every element carries a zero-width themed border, so a component sets only a border width.
 * Plain anchors and buttons get link chrome; a component opts out with `ohne-raw`.
 * Icons ship `stroke-width` 2 and are globally thinned to 1.5; `ohne-stroke-2` reverts.
 */
css`
  :where(*, ::before, ::after) {
    min-width: 0;
    box-sizing: border-box;
    border: 0 solid hsl(var(--ohne-border));
    -webkit-tap-highlight-color: transparent;
    text-underline-offset: 0.125em;
    text-underline-offset: round(0.125em, 1px);
  }

  body {
    min-height: 100dvh;
    margin: 0;
    background-color: hsl(var(--ohne-background));
    color: hsl(var(--ohne-foreground));
    font-family: var(--ohne-font);
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
    -webkit-text-size-adjust: none;
  }

  :where(img, picture, video, canvas, svg) {
    display: block;
    max-width: 100%;
  }

  :where(h1, h2, h3, h4, h5, h6) {
    font-family: var(--ohne-headings);
    font-size: inherit;
    font-weight: 600;
  }

  :where(p, h1, h2, h3, h4, h5, h6) {
    overflow-wrap: break-word;
  }

  :where(blockquote, dd, dl, figure, h1, h2, h3, h4, h5, h6, hr, p, pre) {
    margin: 0;
  }

  :where(ol, ul, menu) {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  :is(a, button):not(.ohne-raw) {
    border-radius: min(var(--ohne-radius), 0.125rem);
    color: hsl(var(--ohne-foreground));
    text-decoration: underline;
    transition: var(--ohne-transition);
    transition-property: color;
  }

  :is(a, button).ohne-raw {
    text-decoration: none;
  }

  :is(a, button):not(.ohne-raw):hover {
    color: hsl(var(--ohne-foreground) / 0.64);
  }

  :is(a, button):not(.ohne-raw):focus-visible {
    box-shadow:
      0 0 0 0.125rem hsl(var(--ohne-background)),
      0 0 0 0.25rem hsl(var(--ohne-ring)),
      0 0 #0000;
    outline: 0.125rem solid transparent;
    outline-offset: 0.125rem;
  }

  :where(strong) {
    font-weight: 600;
  }

  :where(hr) {
    width: 100%;
    border-top-width: 1px;
  }

  :where(input, button, textarea, select) {
    font: inherit;
    margin: 0;
    padding: 0;
  }

  :where([type='button'], [type='reset'], [type='submit'], button) {
    -webkit-appearance: button;
    appearance: button;
    background-color: transparent;
    background-image: none;
  }

  :where([role='button'], button) {
    cursor: pointer;
  }

  :where(button, select) {
    text-transform: none;
  }

  .ohne-icon,
  .ohne-icon [stroke] {
    stroke-width: 1.5;
  }
`;
