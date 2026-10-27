import type { Child } from '../render/insert.ts';
import type { Text } from '../runtime/text.ts';
import type { IconName } from './icon.ts';

import { isUndefined } from '../../utils/is/is-undefined.ts';
import { css } from '../render/css.ts';
import { h } from '../render/h.ts';
import { proseChild } from './_text-child.ts';
import { icon } from './icon.ts';
import { STATUS_TONES, type Tone } from './tone.ts';
import './_tones.ts';
import './tokens.ts';

/**
 * Options for `note`.
 */
export interface NoteOptions {
  /**
   * The icon in front of the text.
   *
   * @default
   * 'info-circle'
   */
  icon?: IconName;

  /**
   * The meaning the note's color carries, painted as `alert` paints it.
   * A status tone tints and rings the note, and a surface tone fills it, each coloring its icon.
   * Omitted, or `primary`, keeps the quiet muted look.
   */
  tone?: Tone;
}

css`
  .ohne-note {
    display: flex;
    gap: 0.5em;
    padding: 0.5em 0.75em;
    background-color: hsl(var(--ohne-muted) / 0.6);
    border-radius: calc(var(--ohne-radius) - 0.125rem);
    color: hsl(var(--ohne-muted-foreground));
    font-size: calc(1rem + var(--ohne-size) * 0.125rem - 0.0625rem);
  }

  .ohne-note > svg {
    font-size: calc(1em + 0.125rem);
    margin-top: 0.125em;
  }

  .ohne-note-toned {
    background-color: hsl(var(--ohne-tone-soft));
    color: hsl(var(--ohne-foreground));
  }

  .ohne-note-status {
    box-shadow: inset 0 0 0 1px hsl(var(--ohne-tone-line));
  }

  .ohne-note-toned > .ohne-note-content {
    --ohne-accent: var(--ohne-tone-ink) / 0.15;
    --ohne-accent-foreground: var(--ohne-tone-ink);
  }

  .ohne-note-toned > svg {
    color: hsl(var(--ohne-tone-ink));
  }

  .ohne-note-content {
    flex: 1;
    min-width: 0;
  }
`;

/**
 * A quiet, muted aside: a hint or a side remark that should not compete with the content.
 * Reach for `alert` instead when the reader must notice it.
 *
 * @example
 * ```ts
 * note('Changes go live after the next deploy.')
 * note('Only officers can edit the guild bank.', { icon: 'lock' })
 * note('Once you save, this is no longer the home page.', { tone: 'warning', icon: 'alert-triangle' })
 * ```
 */
export function note(content: Text | Child, options: NoteOptions = {}): HTMLElement {
  const { tone } = options;
  const look =
    isUndefined(tone) || tone === 'primary'
      ? ''
      : ` ohne-note-toned${STATUS_TONES.has(tone) ? ' ohne-note-status' : ''} ohne-tone-${tone}`;
  return h(
    'div',
    { class: `ohne-note${look}` },
    icon(options.icon ?? 'info-circle'),
    h('div', { class: 'ohne-note-content' }, proseChild(content)),
  );
}
