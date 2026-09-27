import { css } from '../../render/css.ts';

/**
 * The utility class vocabulary.
 * `ohne-clamp` reads its line count from `--ohne-clamp` (default 1).
 * `ohne-no-transition` on `<body>` suppresses every transition during a theme switch.
 */
css`
  .ohne-primary {
    color: hsl(var(--ohne-primary-foreground));
  }

  .ohne-muted {
    color: hsl(var(--ohne-muted-foreground));
  }

  .ohne-unmuted {
    color: hsl(var(--ohne-foreground));
  }

  .ohne-medium {
    font-weight: 500;
  }

  .ohne-block {
    display: block;
  }

  .ohne-flex {
    display: flex;
  }

  .ohne-justify-between {
    display: flex;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .ohne-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .ohne-wrap {
    flex-wrap: wrap;
  }

  .ohne-flex-1 {
    flex: 1;
  }

  .ohne-shrink {
    flex-shrink: 1;
  }

  .ohne-shrink-0 {
    flex-shrink: 0;
  }

  .ohne-relative {
    position: relative;
  }

  .ohne-w-full {
    width: 100%;
  }

  .ohne-mr-auto {
    margin-right: auto;
  }

  .ohne-ml-auto {
    margin-left: auto;
  }

  .ohne-border-none {
    border: none;
  }

  .ohne-center {
    text-align: center;
  }

  .ohne-uppercase {
    text-transform: uppercase;
  }

  .ohne-capitalize {
    text-transform: capitalize;
  }

  .ohne-truncate {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ohne-clamp {
    display: -webkit-box;
    -webkit-line-clamp: var(--ohne-clamp, 1);
    -webkit-box-orient: vertical;
    overflow: hidden;
    line-clamp: var(--ohne-clamp, 1);
  }

  .ohne-whitespace-pre-line {
    white-space: pre-line;
  }

  .ohne-hyphenate {
    hyphens: auto;
  }

  .ohne-invisible {
    visibility: hidden;
  }

  .ohne-no-transition,
  .ohne-no-transition * {
    transition: none !important;
  }

  .ohne-pointer-events-none {
    pointer-events: none;
  }

  .ohne-no-interaction :not(.ohne-dropdown, .ohne-dropdown *) {
    pointer-events: none !important;
  }

  .ohne-no-interaction .ohne-allow-interaction {
    pointer-events: auto !important;
  }

  .ohne-stroke-2,
  .ohne-stroke-2 [stroke] {
    stroke-width: 2 !important;
  }
`;
