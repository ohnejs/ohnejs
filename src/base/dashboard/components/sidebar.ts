import {
  type Child,
  css,
  type DashboardMenuItem,
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
import {
  flattenTree,
  isEmpty,
  isUndefined,
  type RecordHrefTarget,
  recordHref,
  ref,
  type Ref,
  withTrailingSlash,
} from 'ohnejs/utils';

import { type MenuSection, menuSections } from './menu-sections.ts';

css`
  .o-menu-wrapper > * + * {
    margin-top: 1.5em;
  }
`;

/**
 * The sidebar menu column.
 * Each menu section renders one `verticalMenu`, its label as the uppercase title.
 * A nested group renders as a row that expands to show its nodes.
 * Every section shares one expanded state, keyed by node id, so a section reshaped per user keeps it.
 * The link whose target sits closest above the route is active, and its groups expand to show it.
 * A node's icon renders before its label.
 */
export function sidebar(): HTMLElement {
  const t = useT();
  const expandedState = ref<Record<string, boolean>>({});
  return h(
    'div',
    { class: 'o-menu-wrapper' },
    each(
      () => menuSections(dashboardMeta()?.menu ?? []),
      (section) => section.key,
      (section) => menuSection(section, expandedState, t),
    ),
  );
}

/**
 * One menu section, rendered only while it holds a node.
 */
function menuSection(
  section: () => MenuSection,
  expandedState: Ref<Record<string, boolean>>,
  t: Translate,
): Child {
  return when(
    () => !isEmpty(section().items),
    () =>
      verticalMenu({
        title: section().label === '' ? undefined : () => translateMessage(section().label),
        items: () => {
          const active = activeTarget(dashboardMeta()?.menu ?? [], useRoute()?.path ?? '/');
          return section().items.map((node) => menuModel(node, active));
        },
        expandedState,
        ariaCollapseLabel: () => t('dashboard.menu.collapse'),
        ariaExpandLabel: () => t('dashboard.menu.expand'),
      }),
  );
}

/**
 * One node as a menu model, its children as its submenu, the node targeting `active` lit.
 */
function menuModel(node: DashboardMenuItem, active: string | undefined): VerticalMenuItemModel {
  const model: VerticalMenuItemModel = { id: node.id, label: translateMessage(node.label) };
  if (!isUndefined(node.to)) {
    model.to = node.to;
    model.active = node.to === active;
  }
  if (!isUndefined(node.icon)) model.icon = icon(node.icon);
  if (!isUndefined(node.children)) {
    model.submenu = node.children.map((child) => menuModel(child, active));
  }
  return model;
}

/**
 * The target across the whole menu that sits closest above `path`: an exact match, else the longest prefix.
 * `/kit/charts` lights `/kit/charts` over `/kit`, and a record page lights its collection.
 */
export function activeTarget(menu: readonly DashboardMenuItem[], path: string): string | undefined {
  const here = withTrailingSlash(path);
  let best: string | undefined;
  for (const { to } of flattenTree(menu)) {
    if (isUndefined(to)) continue;
    const target = withTrailingSlash(to);
    // Every path sits under the root, so a link targeting it matches exactly instead.
    const holds = target === '/' ? here === '/' : here.startsWith(target);
    if (holds && to.length > (best?.length ?? -1)) best = to;
  }
  return best;
}

/**
 * Whether the menu leads to `collection`: a link to its list, or one its record pages open under.
 * A collection the menu hides is reached by neither, so the overview page leaves it out too.
 */
export function menuReaches(
  menu: readonly DashboardMenuItem[],
  collection: RecordHrefTarget,
): boolean {
  const [record = ''] = recordHref(collection, 'record').split('?');
  const paths = [`/collections/${collection.segment}`, record];
  return paths.some((path) => !isUndefined(activeTarget(menu, path)));
}
