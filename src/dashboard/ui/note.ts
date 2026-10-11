import type { Child } from '../render/insert.ts';
import type { Text } from '../runtime/text.ts';
import type { IconName } from './icon.ts';

import { css } from '../render/css.ts';
import { h } from '../render/h.ts';
import { proseChild } from './_text-child.ts';
import { icon } from './icon.ts';
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
 * ```
 */
export function note(content: Text | Child, options: NoteOptions = {}): HTMLElement {
  return h(
    'div',
    { class: 'ohne-note' },
    icon(options.icon ?? 'info-circle'),
    h('div', { class: 'ohne-note-content' }, proseChild(content)),
  );
}
