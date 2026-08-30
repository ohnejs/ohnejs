import {
  type Child,
  css,
  type DashboardMenuGroup,
  dashboardMeta,
  each,
  h,
  icon,
  type Translate,
  useRoute,
  useT,
  type VerticalMenuItemModel,
  verticalMenu,
  when,
} from 'ohne/dashboard';
import { isEmpty, isUndefined, withTrailingSlash } from 'ohne/utils';

css`
  .o-menu-wrapper > * + * {
    margin-top: 1.5em;
  }
`;

/**
 * The sidebar menu column.
 * Each discovery menu group renders one `verticalMenu`, the group label as its uppercase title.
 * An empty label renders the list without one, and each group row contributes one link.
 * A row is active while the route sits under its target, so record pages highlight their collection.
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
        title: group().label === '' ? undefined : group().label,
        items: () => itemsOf(group()),
        ariaCollapseLabel: t('dashboard.menu.collapse'),
        ariaExpandLabel: t('dashboard.menu.expand'),
      }),
  );
}

/**
 * The group's rows as menu models, active while the route sits at or under the row's target.
 */
function itemsOf(group: DashboardMenuGroup): VerticalMenuItemModel[] {
  const path = withTrailingSlash(useRoute()?.path ?? '/');
  return group.items.map((entry) => {
    const to = withTrailingSlash(entry.to);
    const item: VerticalMenuItemModel = {
      to: entry.to,
      label: entry.label,
      // Every path sits under the root, so a row targeting it matches exactly instead.
      active: to === '/' ? path === '/' : path.startsWith(to),
    };
    if (!isUndefined(entry.icon)) item.icon = icon(entry.icon);
    return item;
  });
}
