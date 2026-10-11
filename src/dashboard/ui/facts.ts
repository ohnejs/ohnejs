import type { Child } from '../render/insert.ts';
import type { Text } from '../runtime/text.ts';

import { isUndefined } from '../../utils/is/is-undefined.ts';
import { type MaybeGetter, toValue } from '../../utils/reactive/to-value.ts';
import { css } from '../render/css.ts';
import { h } from '../render/h.ts';
import { resolveText } from '../runtime/text.ts';
import { skeleton } from './states.ts';
import './tokens.ts';

/**
 * One labeled value in `facts`.
 */
export interface FactRow {
  /**
   * What the value is.
   */
  label: Text;

  /**
   * The value itself: text, a badge, a link, anything.
   */
  value: Child;
}

/**
 * Options for `facts`.
 */
export interface FactsOptions {
  /**
   * How the facts flow.
   * `auto` fits as many columns as the width allows, `2` at most two, `1` stacks them.
   *
   * @default
   * 'auto'
   */
  columns?: 'auto' | 1 | 2;
}

const PLACEHOLDERS = 4;

css`
  .ohne-facts {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 9rem), 1fr));
    gap: 0.75em 1em;
    margin: 0;
    font-size: calc(1rem + var(--ohne-size) * 0.125rem);
  }

  .ohne-facts-1 {
    grid-template-columns: minmax(0, 1fr);
  }

  .ohne-facts-2 {
    grid-template-columns: repeat(auto-fit, minmax(min(100%, max(9rem, calc(50% - 0.5em))), 1fr));
  }

  .ohne-fact {
    display: flex;
    flex-direction: column;
    gap: 0.125em;
    min-width: 0;
  }

  .ohne-fact > dt {
    color: hsl(var(--ohne-muted-foreground));
    font-size: calc(1em - 0.125rem);
  }

  .ohne-fact > dd {
    margin: 0;
    overflow-wrap: anywhere;
  }
`;

/**
 * Labeled values in a responsive grid, a `dl` of small muted labels over their values.
 * Rows given as `undefined` show placeholders at the final height while they load.
 * A getter rebuilds the rows whenever it answers anew.
 *
 * @example
 * ```ts
 * facts([
 *   { label: 'Faction', value: 'Horde' },
 *   { label: 'Home', value: 'Orgrimmar' },
 *   { label: 'Status', value: badge('Warchief', { tone: 'accent' }) },
 * ])
 * ```
 */
export function facts(
  rows: MaybeGetter<readonly FactRow[] | undefined>,
  options: FactsOptions = {},
): HTMLElement {
  return h('dl', { class: `ohne-facts ohne-facts-${options.columns ?? 'auto'}` }, () => {
    const list = toValue(rows);
    return isUndefined(list)
      ? Array.from({ length: PLACEHOLDERS }, () =>
          h('div', { class: 'ohne-fact' }, skeleton({ width: '50%' }), skeleton()),
        )
      : list.map((row) =>
          h(
            'div',
            { class: 'ohne-fact' },
            h('dt', null, () => resolveText(row.label)),
            h('dd', null, row.value),
          ),
        );
  });
}
