import {
  type Child,
  css,
  type DashboardMenuGroup,
  dashboardMeta,
  each,
  h,
  icon,
  type IconName,
  type Translate,
  useRoute,
  useT,
  type VerticalMenuItemModel,
  verticalMenu,
  when,
} from 'ohne/dashboard';
import { isNull, isUndefined, withTrailingSlash } from 'ohne/utils';

css`
  .o-menu-wrapper > * + * {
    margin-top: 1.5em;
  }
`;

/**
 * The sidebar menu column, ported from Pruvious v4's `MenuWrapper` and menu sections.
 * Each discovery menu group renders one `verticalMenu`: the group label as its uppercase title,
 * an empty label rendering the list without one, and one link row per collection.
 * A link is active while the route sits under its collection, so record pages highlight it too.
 * A collection's declared icon renders before its label when it names a registry icon.
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
 * Active mirrors P4's `prepareDashboardMenu`: a trailing-slash-normalized prefix match.
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
    const glyph = iconOf(entry.icon);
    if (!isUndefined(glyph)) item.icon = glyph;
    items.push(item);
  }
  return items;
}

/**
 * The collection's declared menu icon, or `undefined` when it names no registry icon.
 * The registry exports no runtime name guard, so membership shows in the built SVG:
 * a known name parses to element children, an unknown one to none.
 */
function iconOf(name: string | undefined): SVGSVGElement | undefined {
  if (isUndefined(name)) return undefined;
  const glyph = icon(name as IconName);
  return isNull(glyph.firstElementChild) ? undefined : glyph;
}
