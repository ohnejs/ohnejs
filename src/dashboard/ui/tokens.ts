import { css } from '../render/css.ts';

/**
 * The dashboard's design tokens and base styles, adopted once on import.
 *
 * The language is typographic: paper and ink, one accent, hairline rules, no shadows.
 * Every ui component imports this module, so using any of them adopts the tokens.
 * Dark mode follows `prefers-color-scheme` by swapping the palette custom properties.
 */
css`
  :root {
    --paper: #fcfcfa;
    --ink: #17150f;
    --dim: #6f6c63;
    --hairline: #e4e2da;
    --accent: #2230c8;
    --accent-ink: #ffffff;
    --danger: #b3261e;
    --font: 'Helvetica Neue', Helvetica, -apple-system, 'Segoe UI', Arial, sans-serif;
    --mono: ui-monospace, 'SF Mono', Menlo, monospace;
    --pace: 120ms ease-out;
  }

  @media (prefers-color-scheme: dark) {
    :root {
      --paper: #161511;
      --ink: #eceae3;
      --dim: #908d83;
      --hairline: #2b2a24;
      --accent: #93a0ff;
      --accent-ink: #101031;
      --danger: #ff8d85;
    }
  }

  html {
    height: 100%;
  }

  body {
    margin: 0;
    height: 100%;
    background: var(--paper);
    color: var(--ink);
    font: 400 13px/1.5 var(--font);
    -webkit-font-smoothing: antialiased;
  }

  #app {
    height: 100%;
  }

  ::selection {
    background: var(--accent);
    color: var(--accent-ink);
  }

  :focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  a {
    color: inherit;
    text-decoration: none;
  }

  .ohne-caps {
    font-size: 11px;
    font-weight: 500;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--dim);
  }
`;
