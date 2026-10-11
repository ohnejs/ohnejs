import { css } from '../render/css.ts';
import './tokens.ts';

/**
 * The palette every `Tone` paints with, as `.ohne-tone-<tone>` classes a component puts on its root.
 * `--ohne-tone` fills a surface and `--ohne-tone-foreground` writes on it.
 * `--ohne-tone-ink` writes on the card, `--ohne-tone-soft` tints it, and `--ohne-tone-line` outlines.
 * The pale surface tones, `secondary`, `accent` and `neutral`, soften to themselves and ink their foreground.
 */
css`
  .ohne-tone-primary {
    --ohne-tone: var(--ohne-primary);
    --ohne-tone-foreground: var(--ohne-primary-foreground);
    --ohne-tone-ink: var(--ohne-primary);
    --ohne-tone-soft: var(--ohne-primary) / 0.12;
    --ohne-tone-line: var(--ohne-primary);
  }

  .ohne-tone-secondary {
    --ohne-tone: var(--ohne-secondary);
    --ohne-tone-foreground: var(--ohne-secondary-foreground);
    --ohne-tone-ink: var(--ohne-secondary-foreground);
    --ohne-tone-soft: var(--ohne-secondary);
    --ohne-tone-line: var(--ohne-input);
  }

  .ohne-tone-accent {
    --ohne-tone: var(--ohne-accent);
    --ohne-tone-foreground: var(--ohne-accent-foreground);
    --ohne-tone-ink: var(--ohne-accent-foreground);
    --ohne-tone-soft: var(--ohne-accent);
    --ohne-tone-line: var(--ohne-accent);
  }

  .ohne-tone-neutral {
    --ohne-tone: var(--ohne-muted);
    --ohne-tone-foreground: var(--ohne-muted-foreground);
    --ohne-tone-ink: var(--ohne-muted-foreground);
    --ohne-tone-soft: var(--ohne-muted);
    --ohne-tone-line: var(--ohne-input);
  }

  .ohne-tone-destructive {
    --ohne-tone: var(--ohne-destructive);
    --ohne-tone-foreground: var(--ohne-destructive-foreground);
    --ohne-tone-ink: var(--ohne-destructive);
    --ohne-tone-soft: var(--ohne-destructive) / 0.12;
    --ohne-tone-line: var(--ohne-destructive);
  }

  .ohne-tone-success {
    --ohne-tone: var(--ohne-success);
    --ohne-tone-foreground: var(--ohne-success-foreground);
    --ohne-tone-ink: var(--ohne-success);
    --ohne-tone-soft: var(--ohne-success) / 0.12;
    --ohne-tone-line: var(--ohne-success);
  }

  .ohne-tone-warning {
    --ohne-tone: var(--ohne-warning);
    --ohne-tone-foreground: var(--ohne-warning-foreground);
    --ohne-tone-ink: var(--ohne-warning);
    --ohne-tone-soft: var(--ohne-warning) / 0.12;
    --ohne-tone-line: var(--ohne-warning);
  }

  .ohne-tone-info {
    --ohne-tone: var(--ohne-info);
    --ohne-tone-foreground: var(--ohne-info-foreground);
    --ohne-tone-ink: var(--ohne-info);
    --ohne-tone-soft: var(--ohne-info) / 0.12;
    --ohne-tone-line: var(--ohne-info);
  }
`;
