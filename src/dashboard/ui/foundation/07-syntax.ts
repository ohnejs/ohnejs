import { css } from '../../render/css.ts';

/**
 * The syntax highlighting theme, one class per `HighlightKind` as `highlightHTML` and `codeEditor` emit them.
 * Color only, so a span never changes its line's metrics.
 */
css`
  .tk-comment {
    color: hsl(var(--ohne-syntax-comment));
  }

  .tk-string {
    color: hsl(var(--ohne-syntax-string));
  }

  .tk-number {
    color: hsl(var(--ohne-syntax-number));
  }

  .tk-keyword {
    color: hsl(var(--ohne-syntax-keyword));
  }

  .tk-property {
    color: hsl(var(--ohne-syntax-property));
  }

  .tk-type {
    color: hsl(var(--ohne-syntax-type));
  }

  .tk-function {
    color: hsl(var(--ohne-syntax-function));
  }

  .tk-variable {
    color: hsl(var(--ohne-syntax-variable));
  }

  .tk-tag {
    color: hsl(var(--ohne-syntax-tag));
  }

  .tk-attribute {
    color: hsl(var(--ohne-syntax-attribute));
  }
`;
