import type { IconName } from './icon.ts';

import { isUndefined } from '../../utils/is/is-undefined.ts';
import { closestPath } from '../../utils/path/closest-path.ts';
import { computed } from '../../utils/reactive/computed.ts';
import { type MaybeGetter, toValue } from '../../utils/reactive/to-value.ts';
import { hrefPath } from '../../utils/uri/href-path.ts';
import { css } from '../render/css.ts';
import { each } from '../render/each.ts';
import { h } from '../render/h.ts';
import { useLocationPath } from '../router/router.ts';
import { resolveText, type Text } from '../runtime/text.ts';
import { revealActive } from './_reveal-active.ts';
import { icon } from './icon.ts';
import './tabs.ts';
import './tokens.ts';

/**
 * One link of `navTabs`.
 */
export interface NavTab {
  /**
   * The tab label.
   */
  label: Text;

  /**
   * The page the tab links to.
   */
  href: string;

  /**
   * An icon before the label.
   */
  icon?: IconName;
}

/**
 * Options for `navTabs`.
 */
export interface NavTabsOptions {
  /**
   * Size step of the component: -2 very small, -1 small, 0 default, 1 large, 2 very large.
   * Omitted inherits `--ohne-size` from the nearest ancestor.
   */
  size?: number;
}

css`
  .ohne-nav-tabs .ohne-button-group-item:focus-visible {
    box-shadow: 0 0 0 0.125rem hsl(var(--ohne-ring));
  }
`;

/**
 * A row of tabs that link to sibling pages, in the look of `tabs`.
 * The tab whose `href` sits closest above the current path is active, so a page below a tab lights it.
 * Each tab is a real link: it opens in a new tab on a middle click and follows back and forward.
 *
 * @example
 * ```ts
 * navTabs([
 *   { label: 'Overview', href: `/guilds/${id}`, icon: 'home' },
 *   { label: 'Members', href: `/guilds/${id}/members`, icon: 'users' },
 * ])
 * ```
 */
export function navTabs(
  items: MaybeGetter<readonly NavTab[]>,
  options: NavTabsOptions = {},
): HTMLElement {
  const active = computed(() =>
    closestPath(
      toValue(items).map((item) => hrefPath(item.href)),
      useLocationPath(),
    ),
  );
  const strip = h(
    'nav',
    {
      class: 'ohne-nav-tabs ohne-tabs-list ohne-button-group ohne-button-group-accent',
      style: isUndefined(options.size) ? undefined : `--ohne-size: ${options.size}`,
    },
    each(
      () => toValue(items),
      (item) => item.href,
      (item) => {
        const current = (): boolean => active.value === hrefPath(item().href);
        return h(
          'a',
          {
            class: () =>
              'ohne-button-group-item ohne-raw' +
              (current() ? ' ohne-button-group-item-active' : ''),
            href: () => item().href,
            'aria-current': () => (current() ? 'page' : false),
          },
          () => {
            const name = item().icon;
            return isUndefined(name) ? null : icon(name);
          },
          h('span', null, () => resolveText(item().label)),
        );
      },
    ),
  );
  revealActive(strip, () => active.value, '.ohne-button-group-item-active');
  return strip;
}
