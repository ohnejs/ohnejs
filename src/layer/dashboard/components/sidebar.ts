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
import { isUndefined, withTrailingSlash } from 'ohne/utils';

css`
  .o-menu-wrapper > * + * {
    margin-top: 1.5em;
  }
`;

/**
 * The sidebar menu column.
 * Each discovery menu group renders one `verticalMenu`, the group label as its uppercase title.
 * An empty label renders the list without one, and each collection contributes one link row.
 * A link is active while the route sits under its collection, so record pages highlight it too.
 * A collection's declared icon renders before its label.
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
 * One menu group, rendered only while it resolves at least one link.
 */
function menuSection(group: () => DashboardMenuGroup, t: Translate): Child {
  return when(
    () => itemsOf(group()).length > 0,
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
 * The group's link rows: each collection name resolved against the discovery store.
 * Active is a trailing-slash-normalized prefix match.
 */
function itemsOf(group: DashboardMenuGroup): VerticalMenuItemModel[] {
  const collections = dashboardMeta()?.collections ?? [];
  const path = withTrailingSlash(useRoute()?.path ?? '/');
  const items: VerticalMenuItemModel[] = [];
  for (const name of group.collections) {
    const entry = collections.find((candidate) => candidate.name === name);
    if (isUndefined(entry)) continue;
    const to = `/collections/${entry.segment}`;
    const item: VerticalMenuItemModel = {
      to,
      label: entry.label,
      active: path.startsWith(withTrailingSlash(to)),
    };
    if (!isUndefined(entry.icon)) item.icon = icon(entry.icon);
    items.push(item);
  }
  return items;
}
