import type { Child } from '../render/insert.ts';

import { isUndefined } from '../../utils/is/is-undefined.ts';
import { css } from '../render/css.ts';
import { h } from '../render/h.ts';
import { defaultText, resolveText, type Text } from '../runtime/text.ts';
import { useDocumentTitle } from '../runtime/title.ts';
import { proseChild } from './_text-child.ts';
import { icon } from './icon.ts';
import { gapClass } from './layout.ts';
import './tokens.ts';

/**
 * Options for `page`.
 */
export interface PageOptions {
  /**
   * The page's heading, which also names the browser tab.
   */
  title: Text;

  /**
   * A muted line under the heading.
   */
  description?: Text;

  /**
   * Content on the heading's line, usually a `badge`.
   */
  badge?: Child;

  /**
   * The destination of a small back link above the heading.
   */
  back?: string;

  /**
   * Content at the header's end, usually buttons; it moves under the heading in a narrow page.
   */
  actions?: Child;
}

css`
  .ohne-page {
    container: ohne-page / inline-size;
    display: flex;
    flex-direction: column;
    font-size: calc(1rem + var(--ohne-size) * 0.125rem);
  }

  .ohne-page-header {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75em 1em;
    align-items: center;
    justify-content: space-between;
  }

  .ohne-page-heading {
    display: flex;
    flex-direction: column;
    gap: 0.25em;
  }

  /* The second class outranks the base link chrome while keeping its focus ring. */
  .ohne-page-back:not(.ohne-raw) {
    display: inline-flex;
    gap: 0.25em;
    align-items: center;
    align-self: flex-start;
    margin-bottom: 0.25em;
    color: hsl(var(--ohne-muted-foreground));
    font-size: calc(1em - 0.125rem);
    text-decoration: none;
  }

  @media (hover: hover) {
    .ohne-page-back:not(.ohne-raw):hover {
      color: hsl(var(--ohne-foreground));
    }
  }

  .ohne-page-title-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5em;
    align-items: center;
  }

  .ohne-page-title {
    margin: 0;
    font-size: calc(1em + 0.375rem);
    font-weight: 600;
    line-height: 1.4;
    overflow-wrap: anywhere;
  }

  .ohne-page-description {
    margin: 0;
    color: hsl(var(--ohne-muted-foreground));
  }

  .ohne-page-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5em;
    align-items: center;
  }

  @container ohne-page (width < 48rem) {
    .ohne-page-header {
      flex-direction: column;
      align-items: stretch;
    }
  }
`;

/**
 * A dashboard page's content: one header with the `h1`, then the children stacked with gap step `2`.
 * The title also names the browser tab while the page lives, so the two never drift apart.
 * The header's actions sit on the right and move under the heading in a page narrower than `md`.
 *
 * @example
 * ```ts
 * export default defineDashboardPage(() =>
 *   page(
 *     { title: 'Raid roster', description: 'Who answers the call to Icecrown', actions: button('Invite') },
 *     section({ title: 'Tanks' }, card(tanks)),
 *   ),
 * )
 * ```
 */
export function page(options: PageOptions, ...children: Child[]): HTMLElement {
  const { actions, back, badge, description, title } = options;
  useDocumentTitle(title);
  return h(
    'div',
    { class: `ohne-page ${gapClass(2)}` },
    h(
      'header',
      { class: 'ohne-page-header' },
      h(
        'div',
        { class: 'ohne-page-heading' },
        isUndefined(back)
          ? null
          : h('a', { class: 'ohne-page-back', href: back }, icon('arrow-left'), () =>
              defaultText('dashboard.back', 'Back'),
            ),
        h(
          'div',
          { class: 'ohne-page-title-row' },
          h('h1', { class: 'ohne-page-title' }, () => resolveText(title)),
          badge,
        ),
        isUndefined(description)
          ? null
          : h('div', { class: 'ohne-page-description' }, proseChild(description)),
      ),
      isUndefined(actions) ? null : h('div', { class: 'ohne-page-actions' }, actions),
    ),
    ...children,
  );
}
