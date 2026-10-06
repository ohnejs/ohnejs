import type { Child } from '../render/insert.ts';
import type {
  DashboardLayoutCard,
  DashboardLayoutNode,
  DashboardLayoutTabs,
} from '../runtime/meta-types.ts';

import { isUndefined } from '../../utils/is/is-undefined.ts';
import { batchedEffect } from '../../utils/reactive/batched-effect.ts';
import { onCleanup } from '../../utils/reactive/effect-scope.ts';
import { ref } from '../../utils/reactive/ref.ts';
import { css } from '../render/css.ts';
import { h } from '../render/h.ts';
import { when } from '../render/when.ts';
import { useT } from '../runtime/use-t.ts';
import { bubble } from '../ui/bubble.ts';
import { button } from '../ui/button.ts';
import { card } from '../ui/card.ts';
import { icon } from '../ui/icon.ts';
import { tabs, type TabsNavPayload } from '../ui/tabs.ts';
import { attachTooltip } from '../ui/tooltip.ts';
import { layoutNodeNames } from './place-layout.ts';

/**
 * What `renderFieldLayout` needs from the form.
 */
export interface FieldLayoutRenderOptions {
  /**
   * The row for a placed field name; the name is one the form renders.
   */
  row: (name: string) => Child;

  /**
   * Whether the named field's control shows a message; read reactively.
   */
  errored: (name: string) => boolean;

  /**
   * Whether the named field's `when` gate admits it; read reactively.
   * An inactive field's cell hides, and a row, card, or tab holding only inactive fields hides with it.
   */
  active?: (name: string) => boolean;
}

/**
 * A rendered layout: its top-level children and the way into its containers.
 */
export interface RenderedFieldLayout {
  /**
   * The top-level nodes, rendered in order.
   */
  children: Child[];

  /**
   * Activates the tab and expands the collapsed card holding `name`, synchronously.
   * Answers whether the layout places the name.
   */
  reveal: (name: string) => boolean;
}

css`
  .ohne-fields > :not([hidden]) ~ :not([hidden]),
  .ohne-fields-stack > :not([hidden]) ~ :not([hidden]) {
    margin-top: calc(1em + 0.125rem);
  }

  .ohne-fields > :not([hidden]) + .ohne-fields-rule,
  .ohne-fields-stack > :not([hidden]) + .ohne-fields-rule,
  .ohne-fields > .ohne-fields-rule + :not([hidden]),
  .ohne-fields-stack > .ohne-fields-rule + :not([hidden]) {
    margin-top: 0.75rem;
  }

  .ohne-fields-row {
    display: flex;
    column-gap: 0.75rem;
    row-gap: calc(1em + 0.125rem);
    width: 100%;
  }

  .ohne-fields-row > * {
    width: 100%;
  }

  .ohne-fields-row > .ohne-fields-cell-auto {
    width: auto;
    flex-shrink: 0;
  }

  .ohne-fields-card > .ohne-card-header {
    --ohne-padding-header: 0.5rem;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.5rem;
    min-height: 2.75rem;
    padding-left: 0.75rem;
  }

  @media (hover: hover) {
    .ohne-fields-card-collapsible:not(.ohne-fields-card-collapsed)
      > .ohne-card-header
      > .ohne-fields-card-toggle {
      display: none;
    }
  }

  .ohne-fields-card-collapsible:hover > .ohne-card-header > .ohne-fields-card-toggle,
  .ohne-fields-card-collapsible:focus-within > .ohne-card-header > .ohne-fields-card-toggle {
    display: inline-flex;
  }

  .ohne-fields-card-collapsed > .ohne-card-body {
    display: none;
  }

  .ohne-fields-card-collapsed.ohne-fields-card-errored {
    border-color: hsl(var(--ohne-destructive));
  }

  .ohne-fields-tabs .ohne-tabs-content:not(:first-child) {
    margin-top: 1rem;
  }

  .ohne-fields-tabs
    .ohne-tabs-content:not(:first-child)
    > div
    > .ohne-fields-stack
    > .ohne-fields-card:first-child {
    margin-top: calc(-1rem + 0.5em);
  }

  .ohne-fields-tabs-list {
    flex-shrink: 0;
    position: relative;
    width: calc(100% + 1.5rem);
    margin: 0 -0.75rem;
    font-size: calc(1rem + var(--ohne-size) * 0.125rem);
    line-height: 1.5;
    white-space: nowrap;
  }

  .ohne-fields-tabs-scrollable {
    display: flex;
    gap: 0.75rem;
    margin-top: -0.125rem;
    padding: 0.125rem 0.75rem calc(0.75rem + 1px);
    overflow-x: auto;
    scrollbar-width: thin;
    scrollbar-color: hsl(var(--ohne-foreground) / 0.25) transparent;
  }

  .ohne-fields-tabs-scrollable::before {
    content: '';
    position: absolute;
    right: 0;
    bottom: 0;
    left: 0;
    height: 1px;
    background-color: hsl(var(--ohne-border));
  }

  .ohne-fields-tab {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 0.5em;
    position: relative;
    margin: 0 -0.25rem;
    padding: 0 0.25rem;
    border-radius: calc(var(--ohne-radius) - 0.125rem);
    color: hsl(var(--ohne-muted-foreground));
    font-weight: 500;
    transition: var(--ohne-transition);
    transition-property: border-color, box-shadow, color;
  }

  .ohne-fields-tab:focus-visible {
    box-shadow: 0 0 0 0.125rem hsl(var(--ohne-ring));
    outline: none;
  }

  .ohne-fields-tab::after {
    content: '';
    position: absolute;
    right: 0.25rem;
    bottom: calc(-0.75rem - 1px);
    left: 0.25rem;
    height: 1px;
    background-color: hsl(var(--ohne-foreground));
    border-radius: var(--ohne-radius);
    pointer-events: none;
    opacity: 0;
    transition: var(--ohne-transition);
    transition-property: opacity;
  }

  .ohne-fields-tab:hover,
  .ohne-fields-tab-active {
    color: hsl(var(--ohne-foreground));
  }

  .ohne-fields-tab-active::after {
    opacity: 1;
  }

  .ohne-fields-tab .ohne-bubble {
    border: none;
  }

  .ohne-fields-rule {
    width: calc(100% + 1.5rem);
    margin-right: -0.75rem;
    margin-left: -0.75rem;
  }

  @container (max-width: 480px) {
    .ohne-fields-row {
      flex-direction: column;
    }

    .ohne-fields-row > .ohne-fields-cell {
      width: 100%;
      max-width: 100% !important;
    }
  }
`;

/**
 * Renders placed layout nodes into rows, cards, tabs, and rules around the form's own rows.
 * Every panel and card body is built at once; activation and expansion toggle visibility in place.
 * A tab shows the count of errored fields it holds; a collapsed card with errored fields turns destructive.
 */
export function renderFieldLayout(
  nodes: readonly DashboardLayoutNode[],
  options: FieldLayoutRenderOptions,
): RenderedFieldLayout {
  const revealers = new Map<string, (() => void)[]>();
  const render = (list: readonly DashboardLayoutNode[], chain: (() => void)[]): Child[] =>
    list.map((node) => {
      switch (node.kind) {
        case 'field':
          revealers.set(node.name, chain);
          return cell(node.width, options.row(node.name), hiddenUnless(options, [node.name]));
        case 'row':
          return h(
            'div',
            {
              class: 'ohne-fields-row',
              hidden: hiddenUnless(options, layoutNodeNames(node.nodes)),
            },
            render(node.nodes, chain),
          );
        case 'card':
          return renderCard(node, chain, options, render);
        case 'tabs':
          return renderTabs(node, chain, options, render);
        case 'rule':
          return h('hr', { class: 'ohne-fields-rule' });
      }
    });
  return {
    children: render(nodes, []),
    reveal(name) {
      const chain = revealers.get(name);
      if (isUndefined(chain)) return false;
      for (const open of chain) open();
      return true;
    },
  };
}

/**
 * A placed field's wrapper, carrying its declared width: a cap, or `auto` to size it to its content.
 */
function cell(
  width: string | undefined,
  row: Child,
  hidden: (() => boolean) | undefined,
): HTMLElement {
  const auto = width === 'auto';
  return h(
    'div',
    {
      class: `ohne-fields-cell${auto ? ' ohne-fields-cell-auto' : ''}`,
      style: isUndefined(width) || auto ? undefined : `max-width: ${width}`,
      hidden,
    },
    row,
  );
}

/**
 * A reactive `hidden` for a node holding `names`: true once none of them is active.
 */
function hiddenUnless(
  options: FieldLayoutRenderOptions,
  names: readonly string[],
): (() => boolean) | undefined {
  const { active } = options;
  return isUndefined(active) ? undefined : () => !names.some(active);
}

/**
 * A card node: a header with the label and the collapse toggle, over a stack of the inner nodes.
 * Expansion toggles a class in place, so a reveal can focus into the body in the same tick.
 */
function renderCard(
  node: DashboardLayoutCard,
  chain: (() => void)[],
  options: FieldLayoutRenderOptions,
  render: (list: readonly DashboardLayoutNode[], chain: (() => void)[]) => Child[],
): HTMLElement {
  const t = useT();
  const names = layoutNodeNames(node.nodes);
  const expanded = ref(true);
  let root: HTMLElement;
  const setExpanded = (value: boolean): void => {
    expanded.value = value;
    root.classList.toggle('ohne-fields-card-collapsed', !value);
  };
  const toggle = when(
    () => expanded.value,
    () =>
      collapseToggle(
        'maximize',
        'ghost',
        () => t('dashboard.layout.collapse'),
        () => setExpanded(false),
      ),
    () =>
      collapseToggle(
        'minimize',
        'accent',
        () => t('dashboard.layout.expand'),
        () => setExpanded(true),
      ),
  );
  const header =
    isUndefined(node.label) && !node.collapsible
      ? undefined
      : [
          h('span', { class: 'ohne-truncate ohne-muted' }, node.label),
          node.collapsible ? toggle : null,
        ];
  const inner = chain.concat(node.collapsible ? [() => setExpanded(true)] : []);
  root = card(h('div', { class: 'ohne-fields-stack' }, render(node.nodes, inner)), { header });
  root.classList.add('ohne-fields-card');
  const hidden = hiddenUnless(options, names);
  if (!isUndefined(hidden)) batchedEffect(() => (root.hidden = hidden()));
  if (node.collapsible) root.classList.add('ohne-fields-card-collapsible');
  batchedEffect(() => {
    root.classList.toggle('ohne-fields-card-errored', names.some(options.errored));
  });
  return root;
}

/**
 * The small ghost or accent button in a collapsible card's header.
 */
function collapseToggle(
  glyph: 'maximize' | 'minimize',
  variant: 'ghost' | 'accent',
  label: () => string,
  onClick: () => void,
): HTMLElement {
  const el = button(icon(glyph), { size: -2, variant, class: 'ohne-fields-card-toggle', onClick });
  onCleanup(attachTooltip(el, label));
  return el;
}

/**
 * A tabs node: the underline nav over one panel per tab, every panel built at once and hidden in place.
 * Activation toggles `hidden` synchronously, so a reveal can focus into the panel in the same tick.
 */
function renderTabs(
  node: DashboardLayoutTabs,
  chain: (() => void)[],
  options: FieldLayoutRenderOptions,
  render: (list: readonly DashboardLayoutNode[], chain: (() => void)[]) => Child[],
): HTMLElement {
  const t = useT();
  const active = ref(0);
  const panels: HTMLElement[] = [];
  const buttons: HTMLElement[] = [];
  const hiders = node.tabs.map((tab) => hiddenUnless(options, layoutNodeNames(tab.nodes)));
  const visible = (index: number): boolean => hiders[index]?.() !== true;
  const activate = (index: number): void => {
    active.value = index;
    for (const [i, panel] of panels.entries()) panel.hidden = i !== index;
    buttons[index]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };
  for (const [index, tab] of node.tabs.entries()) {
    const panel = h(
      'div',
      { class: 'ohne-fields-stack', hidden: index !== 0 },
      render(tab.nodes, chain.concat([() => activate(index)])),
    );
    panels.push(panel);
  }
  const nav = ({ setActive }: TabsNavPayload<number>): Child =>
    h(
      'div',
      {
        class: 'ohne-fields-tabs-list',
        hidden: isUndefined(options.active)
          ? undefined
          : () => node.tabs.filter((_, index) => visible(index)).length < 2,
      },
      h(
        'div',
        { class: 'ohne-fields-tabs-scrollable' },
        node.tabs.map((tab, index) => {
          const names = layoutNodeNames(tab.nodes);
          const count = (): number => names.filter(options.errored).length;
          const el = h(
            'button',
            {
              type: 'button',
              class: () =>
                `ohne-fields-tab ohne-raw${active.value === index ? ' ohne-fields-tab-active' : ''}`,
              hidden: hiders[index],
              onClick: () => setActive(index),
            },
            h('span', null, tab.label),
            when(
              () => count() > 0,
              () => {
                const mark = bubble(() => count(), { variant: 'destructive' });
                onCleanup(
                  attachTooltip(mark, () => t('dashboard.foundErrors', { count: count() })),
                );
                return mark;
              },
            ),
          );
          buttons.push(el);
          return el;
        }),
      ),
    );
  const root = tabs(() => panels, {
    list: () => node.tabs.map((tab, index) => ({ name: index, label: tab.label })),
    active: () => active.value,
    onChange: activate,
    nav: node.tabs.length > 1 ? nav : () => null,
  });
  root.classList.add('ohne-fields-tabs');
  if (!isUndefined(options.active)) {
    batchedEffect(() => {
      root.hidden = !node.tabs.some((_, index) => visible(index));
      if (visible(active.value)) return;
      const first = node.tabs.findIndex((_, index) => visible(index));
      if (first !== -1) activate(first);
    });
  }
  return root;
}
