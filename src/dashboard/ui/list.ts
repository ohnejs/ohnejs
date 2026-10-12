import type { Child } from '../render/insert.ts';

import { isUndefined } from '../../utils/is/is-undefined.ts';
import { css } from '../render/css.ts';
import { each } from '../render/each.ts';
import { h } from '../render/h.ts';
import { keyed } from '../render/keyed.ts';
import { defaultText, type Text } from '../runtime/text.ts';
import { emptyState, skeleton } from './states.ts';
import './tokens.ts';

/**
 * Options for `list`.
 */
export interface ListOptions<T> {
  /**
   * A stable, unique key per item, so a row keeps its DOM and state when the items change.
   */
  key: (item: T) => unknown;

  /**
   * The text shown when there are no items.
   *
   * @default
   * 'dashboard.noItems'
   */
  empty?: Text;
}

const PLACEHOLDERS = 3;

css`
  .ohne-list {
    margin: 0;
    padding: 0;
    font-size: calc(1rem + var(--ohne-size) * 0.125rem);
    list-style: none;
  }

  .ohne-list-row {
    min-width: 0;
    padding: 0.625em 0.75rem;
  }

  .ohne-list-row + .ohne-list-row {
    border-top-width: 1px;
  }

  .ohne-card-body:has(
    > .ohne-list-root:only-child > .ohne-list,
    > .ohne-loaded:only-child > .ohne-loaded-content > .ohne-list-root:only-child > .ohne-list
  ) {
    padding: 0;
  }
`;

/**
 * Items as divided rows.
 * Alone in a card, the rows run to its edges, since each row carries its own padding.
 * Items as `undefined` show placeholder rows while they load; no items show an empty state.
 * Rows reconcile by `key`, so `render` gets a live getter and runs once per item.
 *
 * @example
 * ```ts
 * card(
 *   list(
 *     () => raids.value,
 *     (raid) => h('span', null, () => raid().name),
 *     { key: (raid) => raid.id, empty: 'No raids scheduled' },
 *   ),
 *   { title: 'Raids' },
 * )
 * ```
 */
export function list<T>(
  items: () => readonly T[] | undefined,
  render: (item: () => T) => Child,
  options: ListOptions<T>,
): HTMLElement {
  const { empty, key } = options;
  return h(
    'div',
    { class: 'ohne-list-root' },
    keyed(
      () => {
        const current = items();
        return isUndefined(current) ? 'loading' : current.length === 0 ? 'empty' : 'items';
      },
      () => {
        const current = items();
        if (isUndefined(current)) {
          return h(
            'ul',
            { class: 'ohne-list', 'aria-busy': 'true' },
            Array.from({ length: PLACEHOLDERS }, () =>
              h('li', { class: 'ohne-list-row' }, skeleton()),
            ),
          );
        }
        if (current.length === 0) {
          return emptyState(empty ?? (() => defaultText('dashboard.noItems', 'Nothing here yet')));
        }
        return h(
          'ul',
          { class: 'ohne-list' },
          each(
            () => items() ?? [],
            (item) => key(item),
            (item) => h('li', { class: 'ohne-list-row' }, render(item)),
          ),
        );
      },
    ),
  );
}
