import { css } from '../../render/css.ts';

/**
 * Typographic flow for rendered rich text under an `ohne-prose` root.
 * Vertical rhythm is margin-top only, scaled by `--ohne-spacing`.
 * `ohne-muted` is intentionally re-declared here so source order keeps it effective inside prose.
 */
css`
  .ohne-prose {
    display: block;
    width: 100%;
    max-width: 100%;
    font-size: calc(1rem + var(--ohne-size) * 0.125rem);
    line-height: calc(calc(1.5 + var(--ohne-line-height, var(--ohne-spacing)) * 0.125) * 1em);
    line-height: round(
      calc(calc(1.5 + var(--ohne-line-height, var(--ohne-spacing)) * 0.125) * 1em),
      1px
    );
  }

  .ohne-prose > :where(*) {
    margin-top: calc(1.5em + var(--ohne-spacing) * 0.25em);
  }

  .ohne-prose > :where(p) + :where(h1, h2, h3, h4, h5, h6) {
    margin-top: calc(2em + var(--ohne-spacing) * 0.25em);
  }

  .ohne-prose > :where(hr) + :where(h1, h2, h3, h4, h5, h6) {
    margin-top: 0;
  }

  .ohne-prose > :where(h1, h2, h3, h4, h5, h6) + :where(p) {
    margin-top: calc(1.25em + var(--ohne-spacing) * 0.25em);
  }

  .ohne-prose > :where(h1, h2, h3, h4, h5, h6) + :where(h1, h2, h3, h4, h5, h6) {
    margin-top: calc(0.75em + var(--ohne-spacing) * 0.25em);
  }

  .ohne-prose > :where(:first-child) {
    margin-top: 0;
  }

  .ohne-prose > :where(h1) {
    font-size: 2em;
  }

  .ohne-prose > :where(h2) {
    font-size: 1.75em;
  }

  .ohne-prose > :where(h3) {
    font-size: 1.5em;
  }

  .ohne-prose > :where(h4) {
    font-size: 1.25em;
  }

  .ohne-prose > :where(h5) {
    font-size: 1.125em;
  }

  .ohne-prose > :where(hr) {
    margin: calc(2.5em + var(--ohne-spacing) * 0.5em) 0;
  }

  .ohne-prose :where(a:not(.ohne-raw)) {
    font-weight: 500;
  }

  .ohne-prose :where(ul, ol) {
    padding-inline-start: 2em;
  }

  .ohne-prose :where(ul) {
    list-style-type: disc;
  }

  .ohne-prose :where(ol) {
    list-style-type: decimal;
    font-variant-numeric: tabular-nums;
  }

  .ohne-prose :where(li) {
    margin-top: calc(0.5em + var(--ohne-spacing) * 0.125em);
  }

  .ohne-prose :where(.ohne-prose-task) {
    list-style: none;
  }

  .ohne-prose :where(.ohne-prose-task) > svg {
    display: inline-block;
    margin-inline-end: 0.375em;
    vertical-align: -0.125em;
  }

  .ohne-prose :where(code) {
    font-family: var(--ohne-font-mono);
  }

  .ohne-prose :where(:not(pre)) :where(code) {
    padding: 0.25em 0.5em;
    background-color: hsl(var(--ohne-accent));
    border-radius: 0.5em;
    color: hsl(var(--ohne-accent-foreground));
    font-size: calc(1em - 0.0625rem);
    font-weight: 500;
    font-style: normal;
    overflow-wrap: anywhere;
    -webkit-box-decoration-break: clone;
    box-decoration-break: clone;
  }

  .ohne-prose :where(pre) {
    width: 100%;
    padding: 1em;
    overflow-x: auto;
    scrollbar-width: thin;
    scrollbar-color: hsl(var(--ohne-foreground) / 0.25) transparent;
    background-color: hsl(var(--ohne-primary));
    border-radius: var(--ohne-radius);
    outline: none;
    color: hsl(var(--ohne-primary-foreground));
    font-family: var(--ohne-font-mono);
    font-size: calc(1em - 0.0625rem);
    font-style: normal;
  }

  .dark .ohne-prose :where(pre) {
    background-color: hsl(var(--ohne-accent));
    color: hsl(var(--ohne-accent-foreground));
  }

  .ohne-prose :where(blockquote) {
    padding-inline-start: calc(0.75em + var(--ohne-spacing) * 0.125em);
    border-left-width: 0.25em;
    font-weight: 500;
  }

  .ohne-prose :where(blockquote) > :where(* + *) {
    margin-top: calc(1em + var(--ohne-spacing) * 0.25em);
  }

  .ohne-prose :where(dt) {
    margin-top: calc(1.5em + var(--ohne-spacing) * 0.25em);
    font-weight: 600;
  }

  .ohne-prose :where(dd) {
    margin-top: calc(0.25em + var(--ohne-spacing) * 0.125em);
    padding-inline-start: calc(1em + var(--ohne-spacing) * 0.125em);
  }

  .ohne-prose :where(.ohne-prose-table) {
    overflow-x: auto;
    scrollbar-width: thin;
    scrollbar-color: hsl(var(--ohne-foreground) / 0.25) transparent;
  }

  .ohne-prose :where(table) {
    width: 100%;
    table-layout: auto;
    border-color: inherit;
    border-collapse: collapse;
    text-indent: 0;
  }

  .ohne-prose :where(thead) {
    border-bottom-width: 2px;
  }

  .ohne-prose :where(tr:not(:last-child)) {
    border-bottom-width: 1px;
  }

  .ohne-prose :where(th, td) {
    padding: calc(0.5em + var(--ohne-spacing) * 0.125em);
    text-align: start;
  }

  .ohne-prose :where(td) {
    vertical-align: top;
    font-variant-numeric: tabular-nums;
  }

  .ohne-prose :where(th) {
    font-weight: 600;
    vertical-align: bottom;
  }

  .ohne-prose :where(figcaption) {
    margin-top: calc(0.5em + var(--ohne-spacing) * 0.125em);
    color: hsl(var(--ohne-muted-foreground));
    font-style: italic;
  }

  .ohne-lead {
    font-size: calc(1em + 0.125rem);
  }

  .ohne-muted {
    color: hsl(var(--ohne-muted-foreground));
  }
`;
