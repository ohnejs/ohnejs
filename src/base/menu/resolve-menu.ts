import { applyHook, type DashboardMenuNode, useCollections, useConfig } from 'ohnejs';
import { isEmpty, isNull, isUndefined, naturalCompare, toSentenceCase } from 'ohnejs/utils';

import type { DashboardMenuItem } from '../api/dashboard.get.ts';
import type { User } from '../auth/types.ts';
import type { DashboardCollection } from '../collections-api/describe.ts';

import { userCan } from '../auth/capabilities.ts';

declare module 'ohnejs' {
  interface Hooks {
    /**
     * Filters the sidebar menu after `dashboard.menu` resolves, before `GET /dashboard` answers.
     * Fires once per discovery read, inside the request context.
     * The assistant fires it too, to list the pages it may open.
     * The tree arrives resolved and pruned for `context.user`, built fresh for this call.
     * Give a new node's label as a message; the dashboard translates it where it renders.
     * Return a replacement tree, or mutate it in place and return nothing.
     */
    'dashboard:menu': (
      menu: DashboardMenuItem[],
      context: { user: User; collections: readonly DashboardCollection[] },
    ) => void | DashboardMenuItem[] | Promise<void | DashboardMenuItem[]>;
  }
}

const DEFAULT_ORDER = 10;

/**
 * One node the tree may hold: as declared, plus the collection it places, if any.
 */
interface MenuEntry {
  node: DashboardMenuNode;
  collection?: DashboardCollection;
}

/**
 * The sidebar `user` sees: `dashboard.menu` resolved over `collections`, then the `dashboard:menu` hook.
 * Valid only within a request.
 */
export function resolveDashboardMenu(
  user: User,
  collections: DashboardCollection[],
): Promise<DashboardMenuItem[]> {
  return applyHook('dashboard:menu', resolveMenu(user, collections), { user, collections });
}

/**
 * Builds the tree from the merged `dashboard.menu` and the collections `user` may reach.
 * It is built fresh on every call, since the hook may mutate what it receives.
 *
 * - Each reachable collection is a node keyed by its name, under `collections` unless it names a `parent`.
 * - A declared collection out of reach drops, and so does every node under it.
 * - A hidden node drops with its subtree, and so does one whose `can` the user lacks.
 * - A group drops while none of its nodes shows; a link stays.
 * - Siblings sort by `order`, then by id, so the tree is the same in every language.
 */
function resolveMenu(user: User, collections: DashboardCollection[]): DashboardMenuItem[] {
  const declared = useConfig().dashboard?.menu ?? {};
  const named = new Set([...useCollections().keys(), ...useConfig().disable.collections]);
  const entries = new Map<string, MenuEntry>();
  for (const [id, node] of Object.entries(declared)) {
    if (!isUndefined(node) && !named.has(id)) entries.set(id, { node });
  }
  for (const collection of collections) {
    entries.set(collection.name, { node: declared[collection.name] ?? {}, collection });
  }
  const children = new Map<string | null, string[]>();
  for (const [id, { node, collection }] of entries) {
    const parent =
      isUndefined(node.parent) && !isUndefined(collection) && entries.has('collections')
        ? 'collections'
        : (node.parent ?? null);
    children.set(parent, [...(children.get(parent) ?? []), id]);
  }
  const build = (parent: string | null): DashboardMenuItem[] =>
    (children.get(parent) ?? [])
      .sort((a, b) => order(entries.get(a)!) - order(entries.get(b)!) || naturalCompare(a, b))
      .flatMap((id) => {
        const { node, collection } = entries.get(id)!;
        if (node.hidden === true || (!isUndefined(node.can) && !userCan(user, node.can))) return [];
        const to = node.to ?? (collection && `/collections/${collection.segment}`);
        const nested = build(id);
        if (isUndefined(to) && isEmpty(nested)) return [];
        const label = node.label ?? collection?.label ?? (isNull(parent) ? '' : toSentenceCase(id));
        const item: DashboardMenuItem = { id, label };
        if (!isUndefined(to)) item.to = to;
        const icon = node.icon ?? collection?.icon;
        if (!isUndefined(icon)) item.icon = icon;
        if (!isEmpty(nested)) item.children = nested;
        return [item];
      });
  return build(null);
}

/**
 * A node's position among its siblings.
 */
function order(entry: MenuEntry): number {
  return entry.node.order ?? DEFAULT_ORDER;
}
