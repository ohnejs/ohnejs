import type { Child } from '../render/insert.ts';

import { isNumber } from '../../utils/is/is-number.ts';
import { isPlainObject } from '../../utils/is/is-plain-object.ts';
import { isUndefined } from '../../utils/is/is-undefined.ts';
import { css } from '../render/css.ts';
import { h } from '../render/h.ts';
import { resolveText, type Text } from '../runtime/text.ts';
import { proseChild } from './_text-child.ts';
import './tokens.ts';

/**
 * A spacing step between laid-out blocks, a multiple of the `--ohne-gap` unit.
 * `-2` is half the unit, `-1` two thirds, `0` the unit, `1` four thirds, and `2` double.
 */
export type Gap = -2 | -1 | 0 | 1 | 2;

/**
 * A container width step the layouts respond to: `sm` 30rem, `md` 48rem, `lg` 64rem, `xl` 80rem.
 * Each step matches its container from that width up.
 */
export type Step = 'sm' | 'md' | 'lg' | 'xl';

/**
 * Options for `section`.
 */
export interface SectionOptions {
  /**
   * The small uppercase heading above the content.
   */
  title?: Text;

  /**
   * A muted line under the heading.
   */
  description?: Text;

  /**
   * Content at the end of the heading row, usually small buttons.
   */
  actions?: Child;

  /**
   * The space between the children.
   *
   * @default
   * 0
   */
  gap?: Gap;
}

/**
 * Options for `stack`.
 */
export interface StackOptions {
  /**
   * The space between the children.
   *
   * @default
   * 0
   */
  gap?: Gap;

  /**
   * How the children sit across the stack.
   *
   * @default
   * 'stretch'
   */
  align?: 'start' | 'center' | 'end' | 'stretch';
}

/**
 * Options for `row`.
 */
export interface RowOptions extends StackOptions {
  /**
   * How the children sit vertically in the row.
   *
   * @default
   * 'center'
   */
  align?: 'start' | 'center' | 'end' | 'stretch';

  /**
   * How the children spread along the row; `between` pushes the first and last to the edges.
   *
   * @default
   * 'start'
   */
  justify?: 'start' | 'center' | 'end' | 'between';

  /**
   * Whether children that do not fit flow onto the next line.
   *
   * @default
   * true
   */
  wrap?: boolean;
}

/**
 * Options for `grid`.
 */
export interface GridOptions {
  /**
   * The narrowest a track may get; the grid fits as many tracks as this allows.
   * A container narrower than this gets one full-width track.
   *
   * @default
   * '16rem'
   */
  min?: string;

  /**
   * The fewest tracks the grid keeps; `2` shrinks the tracks below `min` rather than drop to one.
   *
   * @default
   * 1
   */
  minColumns?: 1 | 2;

  /**
   * A fixed track count, or one per container step that holds from that step up.
   * A step without a count keeps the count below it; `base` applies under `sm` and defaults to 1.
   * Set, it replaces `min` and `minColumns`.
   */
  columns?: number | Partial<Record<'base' | Step, number>>;

  /**
   * The space between the tracks and rows.
   *
   * @default
   * 0
   */
  gap?: Gap;
}

/**
 * Options for `cell`.
 */
export interface CellOptions {
  /**
   * How many tracks the cell spans, or `'full'` for the whole row.
   * A span never outgrows a fixed grid's track count.
   * In a grid without `columns`, a span fills the whole row under the `md` step.
   *
   * @default
   * 1
   */
  span?: number | 'full';
}

/**
 * Options for `split`.
 */
export interface SplitOptions {
  /**
   * The CSS width of the aside column.
   *
   * @default
   * '20rem'
   */
  aside?: string;

  /**
   * Which side the aside sits on while the two are side by side.
   *
   * @default
   * 'end'
   */
  side?: 'start' | 'end';

  /**
   * The container step under which main and aside stack, aside last.
   *
   * @default
   * 'md'
   */
  stackUnder?: Step;

  /**
   * The space between main and aside.
   *
   * @default
   * 1
   */
  gap?: Gap;
}

/**
 * Options for `divider`.
 */
export interface DividerOptions {
  /**
   * A muted label centered on the line.
   */
  label?: Text;
}

/**
 * Options for `toolbar`.
 */
export interface ToolbarOptions {
  /**
   * Whether the toolbar sticks to the top of the scrolling page.
   *
   * @default
   * false
   */
  sticky?: boolean;

  /**
   * The space between the children.
   *
   * @default
   * -1
   */
  gap?: Gap;
}

const GAPS: Readonly<Record<Gap, number>> = { [-2]: 0.5, [-1]: 0.667, 0: 1, 1: 1.333, 2: 2 };

/**
 * The container width each `Step` starts at.
 */
export const STEP_WIDTHS: Readonly<Record<Step, string>> = {
  sm: '30rem',
  md: '48rem',
  lg: '64rem',
  xl: '80rem',
};

css`
  ${Object.entries(GAPS)
    .map(
      ([gap, scale]) =>
        `.ohne-gap-${gap} {
          --ohne-layout-gap: calc(var(--ohne-gap) * ${scale});
          gap: var(--ohne-layout-gap);
        }`,
    )
    .join('\n')}

  .ohne-stack {
    display: flex;
    flex-direction: column;
  }

  .ohne-layout-row {
    display: flex;
  }

  .ohne-layout-wrap {
    flex-wrap: wrap;
  }

  /* A layout spaces its children by gap, so a field drops the rhythm it keeps in plain flow. */
  :is(.ohne-stack, .ohne-layout-row, .ohne-grid, .ohne-split, .ohne-toolbar)
    > :is(.ohne-field, .ohne-field-gate) {
    margin-top: 0;
  }

  /* Cards share a row equally and wrap once narrower than a readable card. */
  .ohne-layout-row > .ohne-card {
    flex: 1 1 16rem;
    width: auto;
  }

  .ohne-layout-items-start {
    align-items: flex-start;
  }

  .ohne-layout-items-center {
    align-items: center;
  }

  .ohne-layout-items-end {
    align-items: flex-end;
  }

  .ohne-layout-items-stretch {
    align-items: stretch;
  }

  .ohne-layout-justify-start {
    justify-content: flex-start;
  }

  .ohne-layout-justify-center {
    justify-content: center;
  }

  .ohne-layout-justify-end {
    justify-content: flex-end;
  }

  .ohne-layout-justify-between {
    justify-content: space-between;
  }

  .ohne-section {
    display: flex;
    flex-direction: column;
    gap: calc(var(--ohne-gap) * ${GAPS[-1]});
  }

  .ohne-section-header {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    align-items: center;
    justify-content: space-between;
    padding: 0 0.125rem;
  }

  .ohne-section-heading {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
  }

  .ohne-section-title {
    margin: 0;
    color: hsl(var(--ohne-muted-foreground));
    font-size: 0.6875rem;
    font-weight: 600;
    letter-spacing: 0.025em;
    text-transform: uppercase;
  }

  .ohne-section-description {
    margin: 0;
    color: hsl(var(--ohne-muted-foreground));
    font-size: 0.8125rem;
  }

  .ohne-section-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    align-items: center;
  }

  .ohne-grid-box {
    container: ohne-grid / inline-size;
    width: 100%;
  }

  .ohne-grid {
    display: grid;
  }

  .ohne-grid-auto {
    grid-template-columns: repeat(auto-fit, minmax(min(100%, var(--ohne-grid-min)), 1fr));
  }

  .ohne-grid-auto.ohne-grid-pair {
    grid-template-columns: repeat(
      auto-fit,
      minmax(min(var(--ohne-grid-min), calc((100% - var(--ohne-layout-gap)) / 2)), 1fr)
    );
  }

  .ohne-grid-fixed {
    grid-template-columns: repeat(var(--ohne-grid-columns), minmax(0, 1fr));
  }

  .ohne-grid-steps {
    --ohne-grid-columns: var(--ohne-grid-base);
  }

  .ohne-grid-auto > .ohne-cell-span {
    grid-column: span var(--ohne-cell-span);
  }

  .ohne-grid-fixed > .ohne-cell-span {
    grid-column: span min(var(--ohne-cell-span), var(--ohne-grid-columns));
  }

  .ohne-grid > .ohne-cell-full {
    grid-column: 1 / -1;
  }

  @container ohne-grid (width < ${STEP_WIDTHS.md}) {
    .ohne-grid-auto > .ohne-cell-span {
      grid-column: 1 / -1;
    }
  }

  ${Object.entries(STEP_WIDTHS)
    .map(
      ([step, width]) =>
        `@container ohne-grid (width >= ${width}) {
          .ohne-grid-steps { --ohne-grid-columns: var(--ohne-grid-${step}); }
        }`,
    )
    .join('\n')}

  .ohne-split-box {
    container: ohne-split / inline-size;
    width: 100%;
  }

  .ohne-split {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    align-items: start;
  }

  ${Object.entries(STEP_WIDTHS)
    .map(
      ([step, width]) => `@container ohne-split (width >= ${width}) {
        .ohne-split-${step}.ohne-split-end { grid-template-columns: minmax(0, 1fr) var(--ohne-split-aside); }
        .ohne-split-${step}.ohne-split-start {
          grid-template-columns: var(--ohne-split-aside) minmax(0, 1fr);
        }
        .ohne-split-${step}.ohne-split-start > .ohne-split-aside { grid-row: 1; grid-column: 1; }
      }`,
    )
    .join('\n')}

  .ohne-divider {
    width: 100%;
    margin: 0;
    border-top-width: 1px;
  }

  .ohne-divider-labeled {
    display: flex;
    gap: 0.75rem;
    align-items: center;
    width: 100%;
    color: hsl(var(--ohne-muted-foreground));
    font-size: 0.75rem;
  }

  .ohne-divider-labeled::before,
  .ohne-divider-labeled::after {
    content: '';
    flex: 1;
    border-top-width: 1px;
  }

  .ohne-toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
  }

  .ohne-toolbar-sticky {
    position: sticky;
    top: 0;
    z-index: 10;
    padding-block: 0.5rem;
    background-color: hsl(var(--ohne-background));
  }
`;

/**
 * The class that spaces a flex or grid element's children by a `Gap` step.
 * It also sets `--ohne-layout-gap` to the resolved length.
 *
 * @example
 * ```ts
 * h('div', { class: `ohne-stack ${gapClass(2)}` }) // -> <div class="ohne-stack ohne-gap-2">
 * ```
 */
export function gapClass(gap: Gap): string {
  return `ohne-gap-${gap}`;
}

/**
 * A titled block of a page: a small uppercase heading over its children.
 * A description sits under the heading and actions at the end of its row.
 * Options are omittable; a section without them is a plain column of its children.
 *
 * @example
 * ```ts
 * section({ title: 'Raid roster', actions: button('Invite') }, card(roster))
 * section(card(roster), card(bench))
 * ```
 */
export function section(options: SectionOptions, ...children: Child[]): HTMLElement;
export function section(...children: Child[]): HTMLElement;
export function section(...args: (SectionOptions | Child)[]): HTMLElement {
  const [{ actions, description, gap = 0, title }, children] = optionsFirst<SectionOptions>(args);
  const header =
    isUndefined(title) && isUndefined(description) && isUndefined(actions)
      ? null
      : h(
          'div',
          { class: 'ohne-section-header' },
          h(
            'div',
            { class: 'ohne-section-heading' },
            isUndefined(title)
              ? null
              : h('h2', { class: 'ohne-section-title' }, () => resolveText(title)),
            isUndefined(description)
              ? null
              : h('div', { class: 'ohne-section-description' }, proseChild(description)),
          ),
          isUndefined(actions) ? null : h('div', { class: 'ohne-section-actions' }, actions),
        );
  return h(
    'section',
    { class: 'ohne-section' },
    header,
    h('div', { class: `ohne-stack ${gapClass(gap)}` }, ...children),
  );
}

/**
 * Lays its children out top to bottom.
 *
 * @example
 * ```ts
 * stack({ gap: 1 }, alert('The portal is unstable'), card(details))
 * stack(heading, text)
 * ```
 */
export function stack(options: StackOptions, ...children: Child[]): HTMLElement;
export function stack(...children: Child[]): HTMLElement;
export function stack(...args: (StackOptions | Child)[]): HTMLElement {
  const [{ align = 'stretch', gap = 0 }, children] = optionsFirst<StackOptions>(args);
  return h('div', { class: `ohne-stack ohne-layout-items-${align} ${gapClass(gap)}` }, ...children);
}

/**
 * Lays its children out side by side, flowing onto new lines when they do not fit.
 * Cards in a row share its width and wrap once they would turn narrower than `16rem`.
 *
 * @example
 * ```ts
 * row({ justify: 'between' }, h('span', null, 'Thrall'), badge('Warchief'))
 * row(button('Save'), button('Cancel', { variant: 'outline' }))
 * ```
 */
export function row(options: RowOptions, ...children: Child[]): HTMLElement;
export function row(...children: Child[]): HTMLElement;
export function row(...args: (RowOptions | Child)[]): HTMLElement {
  const [{ align = 'center', gap = 0, justify = 'start', wrap = true }, children] =
    optionsFirst<RowOptions>(args);
  return h(
    'div',
    {
      class:
        `ohne-layout-row ohne-layout-items-${align} ohne-layout-justify-${justify} ${gapClass(gap)}` +
        (wrap ? ' ohne-layout-wrap' : ''),
    },
    ...children,
  );
}

/**
 * Lays its children out in equal tracks.
 * By default it fits as many tracks of at least `min` as its container allows.
 * With `columns` it holds a fixed count, optionally per container step.
 *
 * @example
 * ```ts
 * grid({ gap: 1 }, card(alliance), card(horde), card(neutral))
 * grid({ columns: { base: 1, md: 2, xl: 4 } }, ...cards)
 * ```
 */
export function grid(options: GridOptions, ...children: Child[]): HTMLElement;
export function grid(...children: Child[]): HTMLElement;
export function grid(...args: (GridOptions | Child)[]): HTMLElement {
  const [{ columns, gap = 0, min = '16rem', minColumns = 1 }, children] =
    optionsFirst<GridOptions>(args);
  const [mode, style] = isUndefined(columns)
    ? [`ohne-grid-auto${minColumns === 2 ? ' ohne-grid-pair' : ''}`, `--ohne-grid-min: ${min}`]
    : isNumber(columns)
      ? ['ohne-grid-fixed', `--ohne-grid-columns: ${columns}`]
      : ['ohne-grid-fixed ohne-grid-steps', stepColumns(columns)];
  return h(
    'div',
    { class: 'ohne-grid-box' },
    h('div', { class: `ohne-grid ${mode} ${gapClass(gap)}`, style }, ...children),
  );
}

/**
 * Wraps one `grid` child so it spans several tracks or the whole row.
 *
 * @example
 * ```ts
 * grid({ columns: 3 }, cell({ span: 2 }, card(chart)), card(totals), cell({ span: 'full' }, card(log)))
 * ```
 */
export function cell(options: CellOptions, child: Child): HTMLElement {
  const { span = 1 } = options;
  return span === 'full'
    ? h('div', { class: 'ohne-cell-full' }, child)
    : h('div', { class: 'ohne-cell-span', style: `--ohne-cell-span: ${span}` }, child);
}

/**
 * Sets a main column beside a fixed-width aside, stacking them, aside last, in a narrow container.
 *
 * @example
 * ```ts
 * split({ side: 'start', aside: '16rem' }, questLog, filters)
 * ```
 */
export function split(options: SplitOptions, main: Child, aside: Child): HTMLElement {
  const { aside: width = '20rem', gap = 1, side = 'end', stackUnder = 'md' } = options;
  return h(
    'div',
    { class: 'ohne-split-box' },
    h(
      'div',
      {
        class: `ohne-split ohne-split-${stackUnder} ohne-split-${side} ${gapClass(gap)}`,
        style: `--ohne-split-aside: ${width}`,
      },
      h('div', null, main),
      h('div', { class: 'ohne-split-aside' }, aside),
    ),
  );
}

/**
 * A horizontal rule between blocks, optionally with a muted label on the line.
 *
 * @example
 * ```ts
 * divider()
 * divider({ label: 'Or' })
 * ```
 */
export function divider(options: DividerOptions = {}): HTMLElement {
  const { label } = options;
  return isUndefined(label)
    ? h('hr', { class: 'ohne-divider' })
    : h(
        'div',
        {
          class: 'ohne-divider-labeled',
          role: 'separator',
          'aria-label': () => resolveText(label),
        },
        () => resolveText(label),
      );
}

/**
 * A wrapping row of controls above the content they act on, optionally sticking to the top on scroll.
 *
 * @example
 * ```ts
 * toolbar({ sticky: true }, search.box, button('New quest'))
 * ```
 */
export function toolbar(options: ToolbarOptions, ...children: Child[]): HTMLElement;
export function toolbar(...children: Child[]): HTMLElement;
export function toolbar(...args: (ToolbarOptions | Child)[]): HTMLElement {
  const [{ gap = -1, sticky = false }, children] = optionsFirst<ToolbarOptions>(args);
  return h(
    'div',
    { class: `ohne-toolbar ${gapClass(gap)}` + (sticky ? ' ohne-toolbar-sticky' : '') },
    ...children,
  );
}

/**
 * Splits a container's arguments into its leading options, when given, and its children.
 */
function optionsFirst<T extends object>(args: readonly (T | Child)[]): [T, Child[]] {
  return isPlainObject(args[0])
    ? [args[0] as T, args.slice(1) as Child[]]
    : [{} as T, args as Child[]];
}

/**
 * The inline custom properties holding a track count per step, each step inheriting the one below.
 */
function stepColumns(columns: Partial<Record<'base' | Step, number>>): string {
  let count = columns.base ?? 1;
  return (['base', 'sm', 'md', 'lg', 'xl'] as const)
    .map((step) => {
      count = columns[step] ?? count;
      return `--ohne-grid-${step}: ${count}`;
    })
    .join('; ');
}
