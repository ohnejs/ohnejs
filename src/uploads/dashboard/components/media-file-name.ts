import { attachTooltip, css, h, when } from 'ohnejs/dashboard';
import { isFunction, onCleanup } from 'ohnejs/utils';

import { splitFileName } from './media-library-state.ts';

/**
 * Options for `mediaFileName`.
 */
export interface MediaFileNameOptions {
  /**
   * Puts the full name in the `title` attribute, so a truncated name reads on hover.
   *
   * @default
   * false
   */
  title?: boolean;

  /**
   * Shows the full name in a tooltip.
   *
   * @default
   * false
   */
  tooltip?: boolean;
}

css`
  .o-media-file-name {
    display: flex;
    min-width: 0;
  }
`;

/**
 * A file name laid out as its stem, a muted dot, and the muted extension.
 * The stem truncates; the extension never does, so `.jpg` survives a narrow tile.
 * A getter as `name` keeps the parts live.
 */
export function mediaFileName(
  name: string | (() => string),
  options: MediaFileNameOptions = {},
): HTMLElement {
  const read = (): string => (isFunction<() => string>(name) ? name() : name);
  const extension = (): string => splitFileName(read()).extension;
  const root = h(
    'span',
    { class: 'o-media-file-name', title: options.title ? read : undefined },
    h(
      'span',
      { class: 'ohne-truncate' },
      h('span', null, () => splitFileName(read()).stem),
      when(
        () => extension() !== '',
        () => h('span', { class: 'ohne-muted' }, '.'),
      ),
    ),
    when(
      () => extension() !== '',
      () => h('span', { class: 'ohne-shrink-0 ohne-muted' }, extension),
    ),
  );
  if (options.tooltip) onCleanup(attachTooltip(root, read));
  return root;
}
