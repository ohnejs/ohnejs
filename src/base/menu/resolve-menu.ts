import {
  applyHook,
  type DashboardMenuEntry,
  type DashboardMenuLink,
  type Message,
  useConfig,
} from 'ohnejs';
import { isEmpty, isString, isUndefined } from 'ohnejs/utils';

import type { DashboardMenuGroup, DashboardMenuItem } from '../api/dashboard.get.ts';
import type { User } from '../auth/types.ts';
import type { DashboardCollection } from '../collections-api/describe.ts';

import { resolveMessage } from '../../ohne/http/translate.ts';

declare module 'ohnejs' {
  interface Hooks {
    /**
     * Filters the sidebar menu after `dashboard.menu` resolves, before `GET /dashboard` answers.
     * Fires once per discovery read, inside the request context, so the viewer's language is in scope.
     * The assistant fires it too, in the default language, to list the pages it may open.
     * The groups arrive resolved: every row carries a `to`, a translated `label`, and any icon.
     * Append a group, reorder the rows, or drop a link the `context.user` should not see.
     * Collection rows are already scoped to what the user may reach; a declared link is not.
     * Return a replacement `DashboardMenuGroup[]`, or mutate the array in place and return nothing.
     */
    'dashboard:menu': (
      menu: DashboardMenuGroup[],
      context: { user: User; collections: readonly DashboardCollection[] },
    ) => void | DashboardMenuGroup[] | Promise<void | DashboardMenuGroup[]>;
  }
}

const DEFAULT_MENU: { label?: Message; items: DashboardMenuEntry[] }[] = [
  { items: [{ to: '/overview', label: 'dashboard.overview.title', icon: 'layout-dashboard' }] },
];

/**
 * The sidebar `user` sees: `dashboard.menu` folded over `collections`, then the `dashboard:menu` hook.
 * Valid only within a request.
 */
export function resolveDashboardMenu(
  user: User,
  collections: DashboardCollection[],
): Promise<DashboardMenuGroup[]> {
  return applyHook('dashboard:menu', resolveMenu(collections), { user, collections });
}

/**
 * Folds the configured `dashboard.menu` over the accessible collections.
 * Configured groups keep their order and drop inaccessible names; the rest trail unlabeled.
 * A named collection is spent on first use, so a later group cannot repeat it.
 * A declared link resolves as authored: the dashboard knows no capability for a page.
 * `DEFAULT_MENU` stands in for an omitted `dashboard.menu`.
 */
function resolveMenu(collections: DashboardCollection[]): DashboardMenuGroup[] {
  const unplaced = new Map(collections.map((collection) => [collection.name, collection]));
  const groups: DashboardMenuGroup[] = [];
  for (const group of useConfig().dashboard?.menu ?? DEFAULT_MENU) {
    const items: DashboardMenuItem[] = [];
    for (const entry of group.items) {
      if (!isString(entry)) {
        items.push(linkItem(entry));
        continue;
      }
      const collection = unplaced.get(entry);
      if (isUndefined(collection)) continue;
      unplaced.delete(entry);
      items.push(collectionItem(collection));
    }
    if (!isEmpty(items)) {
      groups.push({ label: isUndefined(group.label) ? '' : resolveMessage(group.label), items });
    }
  }
  if (unplaced.size > 0) {
    groups.push({ label: '', items: [...unplaced.values()].map(collectionItem) });
  }
  return groups;
}

/**
 * One collection's row: its list route, its label, and its declared icon.
 */
function collectionItem(collection: DashboardCollection): DashboardMenuItem {
  const item: DashboardMenuItem = {
    to: `/collections/${collection.segment}`,
    label: collection.label,
  };
  if (!isUndefined(collection.icon)) item.icon = collection.icon;
  return item;
}

/**
 * One declared link's row, its label resolved in the request's language.
 */
function linkItem(link: DashboardMenuLink): DashboardMenuItem {
  const item: DashboardMenuItem = { to: link.to, label: resolveMessage(link.label) };
  if (!isUndefined(link.icon)) item.icon = link.icon;
  return item;
}
