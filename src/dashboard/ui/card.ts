import type { Child } from '../render/insert.ts';

import { css } from '../render/css.ts';
import { h } from '../render/h.ts';
import './tokens.ts';

/**
 * Options for `card`.
 */
export interface CardOptions {
  /**
   * Content of the header section, rendered above the body with a separating border.
   */
  header?: Child | (() => Child);

  /**
   * Content of the footer section, rendered below the body with a separating border.
   */
  footer?: Child | (() => Child);

  /**
   * Size step of the component: -2 very small, -1 small, 0 default, 1 large, 2 very large.
   * Omitted inherits `--ohne-size` from the nearest ancestor.
   */
  size?: number;
}

css`
  .ohne-card {
    --ohne-background: var(--ohne-card);
    --ohne-foreground: var(--ohne-card-foreground);
    display: block;
    width: 100%;
    max-width: 100%;
    background-color: hsl(var(--ohne-card));
    border-width: 1px;
    border-radius: var(--ohne-radius);
    font-size: calc(1rem + var(--ohne-size) * 0.125rem);
  }

  .ohne-card > :where(*):not(:first-child) {
    border-top-width: 1px;
  }

  .ohne-card-header {
    padding: var(--ohne-padding-header, 0.75rem);
  }

  .ohne-card-body {
    container-type: inline-size;
    padding: var(--ohne-padding-body, 0.75rem);
  }

  .ohne-card-body > :where(*) {
    margin-top: 1em;
  }

  .ohne-card-body > :where(:first-child) {
    margin-top: 0;
  }

  .ohne-card-footer {
    padding: var(--ohne-padding-footer, 0.75rem);
  }
`;

/**
 * A bordered surface with optional header, body, and footer sections.
 * A section renders only when its content is given, and each takes a padding override hook:
 * `--ohne-padding-header`, `--ohne-padding-body`, `--ohne-padding-footer`.
 * The body is an inline-size container, so descendants can key `@container` queries on card width.
 *
 * @example
 * ```ts
 * card(h('p', null, 'Body'), { header: 'Title' })
 * ```
 */
export function card(body?: Child | (() => Child), options: CardOptions = {}): HTMLElement {
  return h(
    'div',
    {
      class: 'ohne-card',
      style: options.size === undefined ? undefined : `--ohne-size: ${options.size}`,
    },
    options.header === undefined ? null : h('div', { class: 'ohne-card-header' }, options.header),
    body === undefined ? null : h('div', { class: 'ohne-card-body' }, body),
    options.footer === undefined ? null : h('div', { class: 'ohne-card-footer' }, options.footer),
  );
}
