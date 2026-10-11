import {
  type Child,
  css,
  type DashboardMenuGroup,
  dashboardMeta,
  each,
  h,
  icon,
  type Translate,
  translateMessage,
  useRoute,
  useT,
  verticalMenu,
  type VerticalMenuItemModel,
  when,
} from 'ohnejs/dashboard';
import { isEmpty, isUndefined, withTrailingSlash } from 'ohnejs/utils';

css`
  .o-menu-wrapper > * + * {
    margin-top: 1.5em;
  }
`;

/**
 * The sidebar menu column.
 * Each discovery menu group renders one `verticalMenu`, the group label as its uppercase title.
 * An empty label renders the list without one, and each group row contributes one link.
 * The row whose target sits closest above the route is active, so record pages highlight their collection.
 * A row's icon renders before its label.
 * The discovery data carries no submenus, so the menu stays flat.
 */
export function sidebar(): HTMLElement {
  const t = useT();
  return h(
    'div',
    { class: 'o-menu-wrapper' },
    each(
      () => dashboardMeta()?.menu ?? [],
      (_, index) => index,
      (group) => menuSection(group, t),
    ),
  );
}

/**
 * One menu group, rendered only while it holds a row.
 */
function menuSection(group: () => DashboardMenuGroup, t: Translate): Child {
  return when(
    () => !isEmpty(group().items),
    () =>
      verticalMenu({
        title: group().label === '' ? undefined : () => translateMessage(group().label),
        items: () => itemsOf(group()),
        ariaCollapseLabel: () => t('dashboard.menu.collapse'),
        ariaExpandLabel: () => t('dashboard.menu.expand'),
      }),
  );
}

/**
 * The group's rows as menu models, the one row whose target holds the route most closely active.
 */
function itemsOf(group: DashboardMenuGroup): VerticalMenuItemModel[] {
  const active = activeTarget(dashboardMeta()?.menu ?? [], useRoute()?.path ?? '/');
  return group.items.map((entry) => {
    const item: VerticalMenuItemModel = {
      to: entry.to,
      label: translateMessage(entry.label),
      active: entry.to === active,
    };
    if (!isUndefined(entry.icon)) item.icon = icon(entry.icon);
    return item;
  });
}

/**
 * The target across every menu group that sits closest above `path`: an exact match, else the longest prefix.
 * `/kit/charts` lights `/kit/charts` over `/kit`, and a record page lights its collection.
 */
export function activeTarget(
  menu: readonly DashboardMenuGroup[],
  path: string,
): string | undefined {
  const here = withTrailingSlash(path);
  let best: string | undefined;
  for (const group of menu) {
    for (const { to } of group.items) {
      const target = withTrailingSlash(to);
      // Every path sits under the root, so a row targeting it matches exactly instead.
      const holds = target === '/' ? here === '/' : here.startsWith(target);
      if (holds && to.length > (best?.length ?? -1)) best = to;
    }
  }
  return best;
}
