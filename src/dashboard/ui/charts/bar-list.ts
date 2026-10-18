import { isUndefined } from '../../../utils/is/is-undefined.ts';
import { changeOf } from '../../../utils/number/change-of.ts';
import { clamp } from '../../../utils/number/clamp.ts';
import { ref } from '../../../utils/reactive/ref.ts';
import { css } from '../../render/css.ts';
import { each } from '../../render/each.ts';
import { h } from '../../render/h.ts';
import { formatNumber } from '../../runtime/number.ts';
import { defaultText } from '../../runtime/text.ts';
import { button } from '../button.ts';
import { delta } from '../stat.ts';
import { skeleton } from '../states.ts';
import { dataFrame } from './_frame.ts';
import { inkStyle } from './_series.ts';
import '../tokens.ts';

/**
 * Options for `barList`.
 */
export interface BarListOptions<T> {
  /**
   * What the row is, like a realm or a page; each row's label is unique.
   */
  label: (row: T) => string;

  /**
   * The number the row's bar measures against the largest row.
   */
  value: (row: T) => number;

  /**
   * The row's number over the previous period, for a change pill beside its value.
   */
  previous?: (row: T) => number;

  /**
   * Formats a value.
   * Omitted writes the number in full in the dashboard language.
   */
  format?: (value: number) => string;

  /**
   * Turns each row into a link to this address.
   */
  href?: (row: T) => string;

  /**
   * How many rows show before a button reveals the rest.
   * Omitted shows every row.
   */
  visible?: number;
}

const MOVES: Record<string, (from: number, last: number) => number> = {
  ArrowDown: (from) => from + 1,
  ArrowUp: (from) => from - 1,
  Home: () => 0,
  End: (_, last) => last,
};

const PLACEHOLDER_ROWS = 5;

css`
  .ohne-bar-list {
    display: flex;
    flex-direction: column;
    margin-inline: -0.5rem;
    font-size: 0.875rem;
  }

  .ohne-bar-list-rows {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .ohne-bar-list-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    gap: 0.375rem 0.625rem;
    align-items: center;
    padding: 0.4375rem 0.5rem;
    border-radius: calc(var(--ohne-radius) - 0.25rem);
    color: inherit;
    outline: none;
  }

  @media (hover: hover) {
    .ohne-bar-list-row:hover {
      background-color: hsl(var(--ohne-muted) / 0.6);
    }
  }

  .ohne-bar-list-row:focus-visible {
    background-color: hsl(var(--ohne-muted) / 0.6);
    box-shadow: inset 0 0 0 0.125rem hsl(var(--ohne-ring));
  }

  .ohne-bar-list-label {
    grid-row: 1;
    grid-column: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ohne-bar-list-row > .ohne-delta {
    grid-row: 1;
    grid-column: 2;
  }

  .ohne-bar-list-value {
    grid-row: 1;
    grid-column: 3;
    min-width: 2.75rem;
    font-variant-numeric: tabular-nums;
    font-weight: 500;
    text-align: right;
  }

  .ohne-bar-list-track {
    display: block;
    grid-row: 2;
    grid-column: 1 / -1;
    height: 0.25rem;
    overflow: hidden;
    border-radius: 9999px;
    background-color: hsl(var(--ohne-foreground) / 0.07);
  }

  .ohne-bar-list-fill {
    display: block;
    height: 100%;
    min-width: 0.25rem;
    border-radius: inherit;
    background-color: hsl(var(--ohne-chart-ink));
  }

  .ohne-bar-list-more {
    display: flex;
    justify-content: center;
    padding-top: 0.5rem;
  }

  .ohne-bar-list-more[hidden] {
    display: none;
  }
`;

/**
 * A ranked list whose rows each carry a thin bar under their label, as long as their share of the top row.
 * The bar sits below the text, never behind it, and the value is printed at the row's end.
 * With `previous`, each row shows its change; with `href`, each row is a link.
 * The list is one Tab stop: the arrow keys, Home and End move between rows.
 * Pass the rows biggest first; `visible` shows the top rows and a button reveals the rest.
 *
 * @example
 * ```ts
 * barList(() => realms.value, {
 *   label: (realm) => realm.name,
 *   value: (realm) => realm.raids,
 *   previous: (realm) => realm.raidsLastWeek,
 *   href: (realm) => `/realms/${realm.slug}`,
 *   visible: 5,
 * })
 * ```
 */
export function barList<T>(
  data: () => readonly T[] | undefined,
  options: BarListOptions<T>,
): HTMLElement {
  const { visible } = options;
  return h(
    'div',
    { class: 'ohne-bar-list' },
    dataFrame(
      data,
      {
        height: `${(visible ?? PLACEHOLDER_ROWS) * 2.5}rem`,
        placeholder: () =>
          h(
            'div',
            { class: 'ohne-bar-list-rows' },
            Array.from({ length: visible ?? PLACEHOLDER_ROWS }, () =>
              h('div', { class: 'ohne-bar-list-row' }, skeleton({ lines: 2 })),
            ),
          ),
      },
      (rows) => list(rows, options),
    ),
  );
}

/**
 * The rows that have arrived, with the reveal button when some are held back.
 */
function list<T>(rows: () => readonly T[], options: BarListOptions<T>): HTMLElement {
  const { href, previous, visible } = options;
  const format = options.format ?? ((value: number) => formatNumber(value));
  const expanded = ref(false);
  const current = ref(0);
  const peak = (): number => {
    const largest = Math.max(...rows().map((row) => options.value(row)));
    return largest > 0 ? largest : 1;
  };
  const shown = (): readonly T[] =>
    expanded.value || isUndefined(visible) ? rows() : rows().slice(0, visible);
  const onKeydown = (event: KeyboardEvent): void => {
    const move = MOVES[event.key];
    const items = [
      ...(event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('.ohne-bar-list-row'),
    ];
    if (isUndefined(move) || items.length === 0) return;
    event.preventDefault();
    const last = items.length - 1;
    current.value = clamp(move(current.value, last), 0, last);
    items[current.value]?.focus();
  };
  return h(
    'div',
    null,
    h(
      'ol',
      { class: 'ohne-bar-list-rows', onKeydown },
      each(
        shown,
        (row) => options.label(row),
        (row, index) =>
          h(
            'li',
            null,
            h(
              isUndefined(href) ? 'div' : 'a',
              {
                class: isUndefined(href) ? 'ohne-bar-list-row' : 'ohne-bar-list-row ohne-raw',
                href: isUndefined(href) ? undefined : () => href(row()),
                tabindex: () => (index() === Math.min(current.value, shown().length - 1) ? 0 : -1),
                onFocus: () => (current.value = index()),
              },
              h('span', { class: 'ohne-bar-list-label' }, () => options.label(row())),
              isUndefined(previous)
                ? null
                : delta(() => changeOf(options.value(row()), previous(row()))),
              h('span', { class: 'ohne-bar-list-value' }, () => format(options.value(row()))),
              h(
                'span',
                { class: 'ohne-bar-list-track', 'aria-hidden': 'true' },
                h('span', {
                  class: 'ohne-bar-list-fill',
                  style: () =>
                    `${inkStyle(1)}; width: ${(Math.max(0, options.value(row())) / peak()) * 100}%`,
                }),
              ),
            ),
          ),
      ),
    ),
    isUndefined(visible)
      ? null
      : h(
          'div',
          { class: 'ohne-bar-list-more', hidden: () => rows().length <= visible },
          button(
            () =>
              expanded.value
                ? defaultText('dashboard.showFewer', 'Show fewer')
                : defaultText('dashboard.showAll', 'Show all'),
            {
              variant: 'ghost',
              size: -1,
              onClick: () => {
                expanded.value = !expanded.value;
                current.value = 0;
              },
            },
          ),
        ),
  );
}
