import type { Ref } from '../../utils/reactive/ref.ts';
import type { Child } from '../render/insert.ts';
import type { IconName } from './icon.ts';

import { isFunction } from '../../utils/is/is-function.ts';
import { isPlainObject } from '../../utils/is/is-plain-object.ts';
import { isUndefined } from '../../utils/is/is-undefined.ts';
import { batchedEffect } from '../../utils/reactive/batched-effect.ts';
import { ref } from '../../utils/reactive/ref.ts';
import { css } from '../render/css.ts';
import { h } from '../render/h.ts';
import { defaultText, resolveText, type Text } from '../runtime/text.ts';
import { button } from './button.ts';
import { icon } from './icon.ts';
import { errorState } from './states.ts';
import './tokens.ts';

/**
 * Options for `card`.
 */
export interface CardOptions {
  /**
   * The heading at the start of the built header.
   */
  title?: Text;

  /**
   * A muted icon before the title.
   */
  icon?: IconName;

  /**
   * Content right after the title, usually a `badge`.
   */
  badge?: Child;

  /**
   * Content at the end of the header, usually small buttons.
   */
  actions?: Child;

  /**
   * Turns the whole card into a link to this destination, with a hover and a focus ring.
   * The card then holds no other link or button, so it takes no `actions`, `more`, `collapsible`, or `header`.
   */
  href?: string;

  /**
   * A muted link at the end of the header, to the page that shows everything the card summarizes.
   */
  more?: {
    /**
     * The link destination; the router intercepts same-origin navigation.
     */
    href: string;

    /**
     * The link text.
     *
     * @default
     * 'dashboard.viewAll'
     */
    label?: Text;
  };

  /**
   * A raw header that replaces the one `title`, `icon`, `badge`, `actions`, and `more` build.
   */
  header?: Child;

  /**
   * Content of the footer section, rendered below the body with a separating border.
   */
  footer?: Child;

  /**
   * Drops the body padding, so a table or a list runs edge to edge.
   *
   * @default
   * false
   */
  flush?: boolean;

  /**
   * Marks the card as a danger zone with a destructive border and title.
   */
  tone?: 'destructive';

  /**
   * Adds a header toggle that folds the body and footer away.
   * `true` starts open; an `open` ref controls the state from outside.
   *
   * @default
   * false
   */
  collapsible?: boolean | { open: Ref<boolean> };

  /**
   * Size step of the component: -2 very small, -1 small, 0 default, 1 large, 2 very large.
   * Omitted inherits `--ohne-size` from the nearest ancestor.
   */
  size?: number;
}

type LinkRule =
  | { href?: undefined }
  | {
      href: string;
      actions?: undefined;
      more?: undefined;
      collapsible?: undefined;
      header?: undefined;
    };

let sequence = 0;

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

  .ohne-card-link {
    color: inherit;
    transition: var(--ohne-transition);
    transition-property: border-color, box-shadow;
  }

  .ohne-card-link:hover {
    border-color: hsl(var(--ohne-foreground) / 0.24);
  }

  .ohne-card-link:focus-visible {
    box-shadow:
      0 0 0 0.125rem hsl(var(--ohne-background)),
      0 0 0 0.25rem hsl(var(--ohne-ring)),
      0 0 #0000;
    outline: 0.125rem solid transparent;
    outline-offset: 0.125rem;
  }

  .ohne-card > :where(:empty) {
    display: none;
  }

  .ohne-card > :where(:not(:empty, [hidden])) ~ :where(*) {
    border-top-width: 1px;
  }

  .ohne-card-header {
    padding: var(--ohne-padding-header, 0.75rem);
  }

  .ohne-card-head {
    display: flex;
    align-items: center;
    gap: 0.5em;
    min-height: 2.75em;
    padding: var(--ohne-padding-header, 0.5rem 0.5rem 0.5rem 0.75rem);
  }

  .ohne-card-icon {
    flex-shrink: 0;
    color: hsl(var(--ohne-muted-foreground));
  }

  .ohne-card-title {
    min-width: 0;
    margin: 0;
    overflow: hidden;
    font-size: calc(1em - 0.125rem);
    font-weight: 500;
    line-height: 1.5;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ohne-card-badge {
    flex-shrink: 0;
    display: flex;
  }

  .ohne-card-end {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 0.5em;
    margin-left: auto;
  }

  .ohne-card-more {
    display: inline-flex;
    align-items: center;
    gap: 0.25em;
    padding: 0 0.25em;
    border-radius: calc(var(--ohne-radius) - 0.125rem);
    outline: none;
    color: hsl(var(--ohne-muted-foreground));
    font-size: calc(1em - 0.125rem);
    font-weight: 500;
    text-decoration: none;
    white-space: nowrap;
    transition: var(--ohne-transition);
    transition-property: box-shadow, color;
  }

  .ohne-card-more:hover {
    color: hsl(var(--ohne-foreground));
  }

  .ohne-card-more:focus-visible {
    box-shadow: 0 0 0 0.125rem hsl(var(--ohne-ring));
  }

  .ohne-card-body {
    --ohne-table-surface: var(--ohne-card);
    container-type: inline-size;
    padding: var(--ohne-padding-body, 0.75rem);
  }

  .ohne-card-body > :where(*) {
    margin-top: 1em;
  }

  .ohne-card-body > :where(:first-child) {
    margin-top: 0;
  }

  .ohne-card-body-flush {
    padding: 0;
  }

  .ohne-card-footer {
    padding: var(--ohne-padding-footer, 0.75rem);
  }

  .ohne-card-destructive {
    --ohne-ring: var(--ohne-destructive);
    border-color: hsl(var(--ohne-destructive));
  }

  .ohne-card-destructive > :where(*) {
    border-color: hsl(var(--ohne-destructive) / 0.32);
  }

  .ohne-card-destructive .ohne-card-title,
  .ohne-card-destructive .ohne-card-icon {
    color: hsl(var(--ohne-destructive));
  }

  .ohne-card-folded .ohne-card-toggle svg {
    transform: rotate(-90deg);
  }

  @media (prefers-reduced-motion: no-preference) {
    .ohne-card-toggle svg {
      transition: transform 150ms cubic-bezier(0.4, 0, 0.2, 1);
    }
  }
`;

/**
 * A bordered surface with an optional header, a body, and an optional footer.
 * `title`, `icon`, `badge`, `actions`, and `more` build the header; `header` replaces it with raw content.
 * With `href` the whole card is one link.
 * A section with nothing to show is not drawn, so no stray border separates it.
 * A function body that throws while building shows an `errorState` in its place.
 * The body is an inline-size container, so descendants can key `@container` queries on card width.
 *
 * @example
 * ```ts
 * card(roster, { title: 'Raid roster', icon: 'users', more: { href: '/raids' } })
 * card(table, { title: 'Guild bank', flush: true, collapsible: true })
 * card(disband, { title: 'Disband the guild', tone: 'destructive' })
 * card(summary, { title: 'Icecrown Citadel', href: '/raids/icecrown' })
 * ```
 */
export function card(body?: Child, options: CardOptions & LinkRule = {}): HTMLElement {
  const { collapsible } = options;
  const open = isPlainObject(collapsible) ? collapsible.open : ref(true);
  const folded = collapsible ? (): boolean => !open.value : undefined;
  const bodyID = collapsible ? `ohne-card-${++sequence}` : undefined;
  const link = !isUndefined(options.href);
  return h(
    link ? 'a' : 'div',
    {
      href: options.href,
      class: () =>
        'ohne-card' +
        (link ? ' ohne-card-link ohne-raw' : '') +
        (options.tone === 'destructive' ? ' ohne-card-destructive' : '') +
        (folded?.() ? ' ohne-card-folded' : ''),
      style: isUndefined(options.size) ? undefined : `--ohne-size: ${options.size}`,
    },
    isUndefined(options.header)
      ? builtHeader(options, open, bodyID)
      : h('div', { class: 'ohne-card-header' }, options.header),
    isUndefined(body)
      ? null
      : h(
          'div',
          {
            id: bodyID,
            class: options.flush ? 'ohne-card-body ohne-card-body-flush' : 'ohne-card-body',
            hidden: folded,
          },
          guarded(body),
        ),
    isUndefined(options.footer)
      ? null
      : h('div', { class: 'ohne-card-footer', hidden: folded }, options.footer),
  );
}

/**
 * The header `title`, `icon`, `badge`, `actions`, `more`, and the collapse toggle build, or `null` without any.
 */
function builtHeader(
  options: CardOptions,
  open: Ref<boolean>,
  bodyID: string | undefined,
): HTMLElement | null {
  const { actions, badge, more, title } = options;
  const end = !isUndefined(actions) || !isUndefined(more) || !isUndefined(bodyID);
  if (isUndefined(title) && isUndefined(options.icon) && isUndefined(badge) && !end) return null;
  return h(
    'div',
    { class: 'ohne-card-header ohne-card-head' },
    isUndefined(options.icon) ? null : cardIcon(options.icon),
    isUndefined(title) ? null : h('h3', { class: 'ohne-card-title' }, () => resolveText(title)),
    isUndefined(badge) ? null : h('span', { class: 'ohne-card-badge' }, badge),
    end
      ? h(
          'div',
          { class: 'ohne-card-end' },
          actions,
          isUndefined(more) ? null : moreLink(more.href, more.label),
          isUndefined(bodyID) ? null : toggle(open, bodyID),
        )
      : null,
  );
}

/**
 * The muted header icon.
 */
function cardIcon(name: IconName): SVGSVGElement {
  const svg = icon(name);
  svg.classList.add('ohne-card-icon');
  return svg;
}

/**
 * The muted "view all" link, its text followed by an arrow.
 */
function moreLink(href: string, label: Text | undefined): HTMLElement {
  return h(
    'a',
    { class: 'ohne-card-more ohne-raw', href },
    h('span', null, () =>
      isUndefined(label) ? defaultText('dashboard.viewAll', 'View all') : resolveText(label),
    ),
    icon('arrow-right'),
  );
}

/**
 * The ghost chevron that folds and unfolds the body, wired as a disclosure button.
 */
function toggle(open: Ref<boolean>, bodyID: string): HTMLElement {
  const el = button(
    () =>
      open.value
        ? defaultText('dashboard.collapse', 'Collapse')
        : defaultText('dashboard.expand', 'Expand'),
    {
      icon: 'chevron-down',
      iconOnly: true,
      variant: 'ghost',
      size: -2,
      class: 'ohne-card-toggle',
      onClick: () => {
        open.value = !open.value;
      },
    },
  );
  el.setAttribute('aria-controls', bodyID);
  batchedEffect(() => el.setAttribute('aria-expanded', String(open.value)));
  return el;
}

/**
 * A function body that shows an `errorState` instead of throwing out of the card.
 */
function guarded(body: Child): Child {
  if (!isFunction<() => Child>(body)) return body;
  return () => {
    try {
      return body();
    } catch (error) {
      console.error(error);
      return errorState();
    }
  };
}
