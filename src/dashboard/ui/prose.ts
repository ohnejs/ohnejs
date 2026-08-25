import type { Child } from '../render/insert.ts';

import { h } from '../render/h.ts';
import './tokens.ts';

/**
 * Options for `prose`.
 */
export interface ProseOptions {
  /**
   * Size step of the component: -2 very small, -1 small, 0 default, 1 large, 2 very large.
   * Omitted inherits `--ohne-size` from the nearest ancestor.
   */
  size?: number;

  /**
   * Spacing step between elements and text: -2 very tight, -1 tight, 0 default, 1 loose, 2 very loose.
   * Omitted inherits `--ohne-spacing` from the nearest ancestor.
   */
  spacing?: number;
}

/**
 * A typographic flow container, ported from PUIProse.
 * Wraps rich content in the foundation's `ohne-prose` class, which supplies the vertical rhythm.
 *
 * @example
 * ```ts
 * prose([h('h2', null, 'Title'), h('p', null, 'Body text.')], { spacing: -1 })
 * ```
 */
export function prose(content: Child, options: ProseOptions = {}): HTMLElement {
  const style = [
    options.size === undefined ? '' : `--ohne-size: ${options.size}`,
    options.spacing === undefined ? '' : `--ohne-spacing: ${options.spacing}`,
  ]
    .filter(Boolean)
    .join('; ');
  return h('div', { class: 'ohne-prose', style: style || undefined }, content);
}
