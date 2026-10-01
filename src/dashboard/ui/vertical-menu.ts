import type { Ref } from '../../utils/reactive/ref.ts';

import { isNull } from '../../utils/is/is-null.ts';
import { isString } from '../../utils/is/is-string.ts';
import { isUndefined } from '../../utils/is/is-undefined.ts';
import { onCleanup } from '../../utils/reactive/effect-scope.ts';
import { effect } from '../../utils/reactive/effect.ts';
import { ref } from '../../utils/reactive/ref.ts';
import { untracked } from '../../utils/reactive/untracked.ts';
import { css } from '../render/css.ts';
import { each } from '../render/each.ts';
import { h } from '../render/h.ts';
import { type Child } from '../render/insert.ts';
import { when } from '../render/when.ts';
import { icon, type IconName } from './icon.ts';
import { attachTooltip } from './tooltip.ts';
import './tokens.ts';

/**
 * One entry in a `verticalMenu`.
 */
export interface VerticalMenuItemModel {
  /**
   * The link target; the router intercepts same-origin navigation.
   *
   * Either provide a `to` or an `action` property, but not both.
   */
  to?: string;

  /**
   * The callback function to execute when the item is clicked.
   *
   * Either provide a `to` or an `action` property, but not both.
   */
  action?: (event: MouseEvent) => void;

  /**
   * The button label.
   */
  label: string;

  /**
   * The button icon: an icon name, or a ready element.
   */
  icon?: IconName | Element;

  /**
   * A muted note at the end of the row, such as a relative time.
   */
  hint?: {
    /**
     * The note.
     */
    text: string;

    /**
     * The note's tooltip, shown as written, with `\n` as its only break.
     */
    tooltip?: string;
  };

  /**
   * Whether the item is active.
   * If the item is a submenu item, it will automatically expand all parent items.
   *
   * @default
   * false
   */
  active?: boolean;

  /**
   * An array of submenu items.
   */
  submenu?: VerticalMenuItemModel[];
}

/**
 * Options for `verticalMenu`.
 */
export interface VerticalMenuOptions {
  /**
   * The menu title; a getter reads reactively.
   */
  title?: string | (() => string);

  /**
   * The menu items, read reactively.
   */
  items?: () => VerticalMenuItemModel[];

  /**
   * The expanded state of the items, keyed by hyphen-joined index path (`'0'`, `'0-2'`, ...).
   * It is two-way: the items keep it updated, and a caller write is reflected immediately.
   * Omitted, the menu keeps the state internally.
   */
  expandedState?: Ref<Record<string, boolean>>;

  /**
   * The label for the expand buttons.
   * Only applies for items with submenus.
   *
   * @default
   * 'Expand'
   */
  ariaExpandLabel?: string;

  /**
   * The label for the collapse buttons.
   * Only applies for items with submenus.
   *
   * @default
   * 'Collapse'
   */
  ariaCollapseLabel?: string;

  /**
   * Size step of the component: -2 very small, -1 small, 0 default, 1 large, 2 very large.
   * Omitted, the menu's own CSS default of `-1` applies.
   */
  size?: number;
}

/**
 * Options for `verticalMenuItem`.
 */
export interface VerticalMenuItemOptions {
  /**
   * The hyphen-joined index path identifying the item (`'0'`, `'0-2'`, `'0-2-1'`).
   * It is the key into the expanded state.
   */
  id: string;

  /**
   * The item model, read reactively.
   */
  item: () => VerticalMenuItemModel;

  /**
   * The expanded state shared by the whole menu tree, two-way.
   * Expanding an item also expands every ancestor; collapsing touches only the item itself.
   */
  expandedState: Ref<Record<string, boolean>>;

  /**
   * The label for the expand button.
   * Only applies when the item has a submenu.
   *
   * @default
   * 'Expand'
   */
  ariaExpandLabel?: string;

  /**
   * The label for the collapse button.
   * Only applies when the item has a submenu.
   *
   * @default
   * 'Collapse'
   */
  ariaCollapseLabel?: string;
}

css`
  .ohne-vertical-menu {
    --ohne-size: -1;
    font-size: calc(1rem + var(--ohne-size) * 0.125rem);
  }

  .ohne-vertical-menu-title {
    display: block;
    margin-bottom: 0.5em;
    font-weight: 600;
    text-transform: uppercase;
    font-size: calc(1em - 0.1875rem);
    line-height: calc(1em + 0.5rem);
  }

  .ohne-vertical-menu-list {
    position: relative;
  }
`;

css`
  .ohne-vertical-menu-item {
    position: relative;
  }

  .ohne-vertical-menu-item + .ohne-vertical-menu-item {
    margin-top: 0.125rem;
  }

  .ohne-vertical-menu-item-wrapper {
    display: flex;
    gap: 0.125rem;
  }

  .ohne-vertical-menu-item-button {
    position: relative;
    z-index: 1;
    display: flex;
    align-items: center;
    gap: 0.5em;
    width: 100%;
    height: calc(2em + 0.25rem);
    padding: 0 0.5em;
    border-radius: var(--ohne-radius);
    color: hsl(var(--ohne-muted-foreground));
    text-decoration: none;
    transition: var(--ohne-transition);
    transition-property: background-color, box-shadow, color;
  }

  .ohne-vertical-menu-item-button,
  .ohne-vertical-menu-item-button > span {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .ohne-vertical-menu-item-button > .ohne-vertical-menu-item-hint {
    flex-shrink: 0;
    margin-left: auto;
    font-size: calc(1em - 0.125rem);
    opacity: 0.72;
  }

  .ohne-vertical-menu-item-hint + .ohne-vertical-menu-item-button-toggle {
    margin-left: 0;
  }

  .ohne-vertical-menu-item-button:hover {
    background-color: hsl(var(--ohne-secondary));
    color: hsl(var(--ohne-secondary-foreground));
  }

  .ohne-vertical-menu-item-button:focus-visible {
    box-shadow: inset 0 0 0 0.125rem hsl(var(--ohne-ring));
    outline: none;
  }

  .ohne-vertical-menu-item-active > .ohne-vertical-menu-item-button,
  .ohne-vertical-menu-item-active
    > .ohne-vertical-menu-item-wrapper
    > .ohne-vertical-menu-item-button {
    background-color: hsl(var(--ohne-accent));
    color: hsl(var(--ohne-accent-foreground));
  }

  .ohne-vertical-menu-item-active
    > .ohne-vertical-menu-item-wrapper
    > .ohne-vertical-menu-item-button {
    color: hsl(var(--ohne-accent-foreground));
    font-weight: 500;
  }

  .ohne-vertical-menu-item-button > svg {
    flex-shrink: 0;
    font-size: calc(1em + 0.125rem);
  }

  .ohne-vertical-menu-item-button > .ohne-vertical-menu-item-button-toggle {
    flex-shrink: 0;
    display: flex;
    width: calc(2em + 0.25rem);
    height: calc(2em + 0.25rem);
    margin-right: -0.5em;
    margin-left: auto;
  }

  .ohne-vertical-menu-item-button > .ohne-vertical-menu-item-button-toggle > svg {
    margin: auto;
  }

  .ohne-vertical-menu-item-toggle {
    flex-shrink: 0;
    display: flex;
    width: calc(2em + 0.25rem);
    height: calc(2em + 0.25rem);
    border-radius: var(--ohne-radius);
    color: hsl(var(--ohne-muted-foreground));
    transition: var(--ohne-transition);
    transition-property: background-color, box-shadow, color;
  }

  .ohne-vertical-menu-item-toggle:hover {
    background-color: hsl(var(--ohne-secondary));
    color: hsl(var(--ohne-secondary-foreground));
  }

  .ohne-vertical-menu-item-toggle:focus-visible {
    box-shadow: inset 0 0 0 0.125rem hsl(var(--ohne-ring));
    outline: none;
    color: hsl(var(--ohne-accent-foreground));
  }

  .ohne-vertical-menu-item-expanded
    > .ohne-vertical-menu-item-wrapper
    > .ohne-vertical-menu-item-toggle,
  .ohne-vertical-menu-item-expanded
    > .ohne-vertical-menu-item-wrapper
    > .ohne-vertical-menu-item-button
    > .ohne-vertical-menu-item-button-toggle {
    transform: rotate(90deg);
  }

  .ohne-vertical-menu-item-toggle > svg {
    display: block;
    margin: auto;
    transition: var(--ohne-transition);
    transition-property: transform;
  }

  .ohne-vertical-menu-submenu {
    margin-top: 0.125rem;
    margin-left: calc(1.5em + 0.125rem);
  }
`;

let sequence = 0;

/**
 * Sidebar navigation.
 * An optional uppercase title sits above a recursive list of expandable items.
 * The expanded state is keyed by each item's index path, so reordering `items` remaps it.
 * An active leaf auto-expands all of its ancestors.
 *
 * @example
 * ```ts
 * verticalMenu({
 *   title: 'Collections',
 *   items: () => [{ to: '/pages', label: 'Pages', icon: 'note', active: true }],
 * })
 * ```
 */
export function verticalMenu(options: VerticalMenuOptions = {}): HTMLElement {
  const titleId = `ohne-vertical-menu-title-${++sequence}`;
  const expandedState = options.expandedState ?? ref<Record<string, boolean>>({});
  return h(
    'div',
    {
      role: 'navigation',
      class: 'ohne-vertical-menu',
      style: isUndefined(options.size) ? undefined : `--ohne-size: ${options.size}`,
    },
    isUndefined(options.title)
      ? null
      : h('span', { id: titleId, class: 'ohne-vertical-menu-title' }, options.title),
    h(
      'ul',
      {
        'aria-labelledby': isUndefined(options.title) ? undefined : titleId,
        role: 'list',
        class: 'ohne-vertical-menu-list',
      },
      each(
        () => options.items?.() ?? [],
        (_, index) => index,
        (item, index) =>
          verticalMenuItem({
            id: String(index()),
            item,
            expandedState,
            ariaExpandLabel: options.ariaExpandLabel,
            ariaCollapseLabel: options.ariaCollapseLabel,
          }),
      ),
    ),
  );
}

/**
 * One menu row.
 * It is a link, an action button, or a pure toggle, with an optional recursive submenu.
 * A collapsed submenu stays in the DOM, hidden.
 * Children keep their recorded expanded state and reappear when the parent reopens.
 * ArrowUp and ArrowDown move focus through the menu's buttons in document order.
 * ArrowLeft collapses and ArrowRight expands from any focused descendant.
 * Rows are usually built by `verticalMenu`; call this directly only for a detached single row.
 *
 * @example
 * ```ts
 * verticalMenuItem({ id: '0', item: () => ({ label: 'Pages', to: '/pages' }), expandedState })
 * ```
 */
export function verticalMenuItem(options: VerticalMenuItemOptions): HTMLElement {
  const { id, item, expandedState } = options;
  const expandLabel = options.ariaExpandLabel ?? 'Expand';
  const collapseLabel = options.ariaCollapseLabel ?? 'Collapse';
  const isExpanded = (): boolean => expandedState.value[id] === true;

  const expand = (): void => {
    const state = { ...untracked(() => expandedState.value) };
    let current = '';
    for (const segment of id.split('-')) {
      current += segment;
      state[current] = true;
      current += '-';
    }
    expandedState.value = state;
  };

  const collapse = (): void => {
    expandedState.value = { ...untracked(() => expandedState.value), [id]: false };
  };

  let previousActive: boolean | undefined;
  effect(() => {
    const isActive = item().active === true;
    if (isUndefined(previousActive) || isActive !== previousActive) {
      previousActive = isActive;
      if (isActive) untracked(expand);
    }
  });

  const focusStep = (event: KeyboardEvent, offset: number): void => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const menu = target.closest('.ohne-vertical-menu');
    if (isNull(menu)) return;
    const buttons = [...menu.querySelectorAll<HTMLElement>('.ohne-vertical-menu-item-button')];
    const index = buttons.indexOf(target as HTMLElement);
    buttons[index + offset]?.focus();
  };

  const onButtonKeydown = (event: KeyboardEvent): void => {
    if (event.key === 'ArrowDown') focusStep(event, 1);
    else if (event.key === 'ArrowUp') focusStep(event, -1);
  };

  const toggle = (): void => {
    if (untracked(isExpanded)) collapse();
    else expand();
  };

  const iconChild = (): Element | undefined => {
    const glyph = item().icon;
    return isString(glyph) ? icon(glyph) : glyph;
  };

  // Built once while the item has a hint, so a tooltip survives the item's every re-read.
  const hintChild = (): Child =>
    when(
      () => !isUndefined(item().hint),
      () => {
        const note = h('span', { class: 'ohne-vertical-menu-item-hint' }, () => item().hint?.text);
        onCleanup(attachTooltip(note, () => item().hint?.tooltip ?? null, { plain: true }));
        return note;
      },
    );

  const toggleRow = (): HTMLElement =>
    h(
      'div',
      { class: 'ohne-vertical-menu-item-wrapper' },
      h(
        'button',
        {
          'aria-expanded': () => String(isExpanded()),
          'aria-label': () =>
            item().submenu?.length ? (isExpanded() ? collapseLabel : expandLabel) : null,
          type: 'button',
          class: 'ohne-vertical-menu-item-button ohne-raw',
          onClick: () => {
            if (untracked(item).submenu?.length) toggle();
          },
          onKeydown: onButtonKeydown,
        },
        iconChild,
        h('span', null, () => item().label),
        hintChild(),
        h('span', { class: 'ohne-vertical-menu-item-button-toggle' }, icon('chevron-right')),
      ),
    );

  const linkRow = (link: boolean): HTMLElement =>
    h(
      'div',
      { class: 'ohne-vertical-menu-item-wrapper' },
      h(
        link ? 'a' : 'button',
        {
          href: link ? () => item().to : undefined,
          type: link ? undefined : 'button',
          class: 'ohne-vertical-menu-item-button ohne-raw',
          onClick: (event: MouseEvent) => item().action?.(event),
          onKeydown: onButtonKeydown,
        },
        iconChild,
        h('span', null, () => item().label),
        hintChild(),
      ),
      when(
        () => (item().submenu?.length ?? 0) > 0,
        () =>
          h(
            'button',
            {
              'aria-expanded': () => String(isExpanded()),
              'aria-label': () => (isExpanded() ? collapseLabel : expandLabel),
              type: 'button',
              class: 'ohne-vertical-menu-item-toggle ohne-raw',
              onClick: toggle,
            },
            icon('chevron-right'),
          ),
      ),
    );

  const kind = (): 'toggle' | 'button' | 'link' => {
    const current = item();
    if (!current.to && !current.action) return 'toggle';
    return current.to ? 'link' : 'button';
  };
  const kindRef = ref(untracked(kind));
  effect(() => {
    kindRef.value = kind();
  });

  return h(
    'li',
    {
      class: () =>
        'ohne-vertical-menu-item' +
        (item().active ? ' ohne-vertical-menu-item-active' : '') +
        (isExpanded() ? ' ohne-vertical-menu-item-expanded' : ''),
      onKeydown: (event: KeyboardEvent) => {
        if (event.key === 'ArrowLeft') {
          event.stopPropagation();
          collapse();
        } else if (event.key === 'ArrowRight') {
          event.stopPropagation();
          expand();
        }
      },
    },
    () => {
      const current = kindRef.value;
      return current === 'toggle' ? toggleRow() : linkRow(current === 'link');
    },
    h(
      'ul',
      {
        role: 'list',
        class: 'ohne-vertical-menu-submenu',
        style: () => ((item().submenu?.length ?? 0) > 0 && isExpanded() ? null : 'display: none'),
      },
      each(
        () => item().submenu ?? [],
        (_, index) => index,
        (sub, index) =>
          verticalMenuItem({
            id: `${id}-${index()}`,
            item: sub,
            expandedState,
            ariaExpandLabel: options.ariaExpandLabel,
            ariaCollapseLabel: options.ariaCollapseLabel,
          }),
      ),
    ),
  );
}
