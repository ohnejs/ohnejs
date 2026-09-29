import {
  applyHook,
  blockQueryMetadata,
  type Capability,
  type DashboardMenuEntry,
  type DashboardMenuLink,
  defineHandler,
  type Message,
  queryMetadata,
  useBlocks,
  useCollections,
  useConfig,
  useMessages,
  useRoles,
  useRoutes,
} from 'ohnejs';
import {
  isEmpty,
  isString,
  isUndefined,
  naturalCompare,
  pick,
  toSentenceCase,
  uniqueArray,
} from 'ohnejs/utils';

import type { IconName } from '../../utils/icon/icon-name.ts';
import type { User } from '../auth/types.ts';
import type {
  DashboardCollection,
  DashboardField,
  DashboardLayoutNode,
} from '../collections-api/describe.ts';

import { resolveLocales } from '../../ohne/collections/resolve-locales.ts';
import { defaultLanguage, resolveMessage } from '../../ohne/http/translate.ts';
import { accountFields, accountLayout } from '../auth/account-layout.ts';
import { userCapabilities } from '../auth/capabilities.ts';
import { requireUser } from '../auth/require-user.ts';
import { describeCollections, describeFields, resolveLayout } from '../collections-api/describe.ts';

/**
 * One block type a `blocks` field may hold, described for the dashboard's editors.
 *
 * Block types are named, never inlined, since a block may admit its own type.
 * A field's `allow` names its members; `DashboardMeta.blocks` describes them.
 */
export interface DashboardBlock {
  /**
   * The registered block name, in PascalCase; a block item's `block` key carries it.
   */
  name: string;

  /**
   * The display label, resolved in the request's language.
   * A declared `label` resolves through the message catalogs; omitted falls back to the sentence-cased name.
   */
  label: string;

  /**
   * The block's own fields, its instance `UUID` included; a block carries no `_updatedAt`.
   */
  fields: DashboardField[];

  /**
   * How the block's form arranges the fields, resolved; absent when the block declares no layout.
   */
  layout?: DashboardLayoutNode[];
}

/**
 * One role the app declares, described for the dashboard's role pickers.
 */
export interface DashboardRole {
  /**
   * The role name, as a user's `roles` field stores it.
   */
  name: string;

  /**
   * The display label, resolved in the request's language.
   * A declared `label` resolves through the message catalogs; omitted falls back to the sentence-cased name.
   */
  label: string;

  /**
   * The declared `description`, resolved in the request's language; absent when the role declares none.
   */
  description?: string;
}

/**
 * One sidebar menu row: a link the dashboard draws, already resolved for the signed-in user.
 * A collection row and a declared page link arrive in the same shape, so the sidebar renders one kind.
 */
export interface DashboardMenuItem {
  /**
   * The dashboard path the row opens; a collection row points at its list route.
   */
  to: string;

  /**
   * The row label, resolved in the request's language.
   */
  label: string;

  /**
   * The Tabler icon shown before the label; absent when the row declares none.
   */
  icon?: IconName;
}

/**
 * One sidebar menu group: a heading and the rows it holds.
 */
export interface DashboardMenuGroup {
  /**
   * The group heading, resolved in the request's language; `''` renders the group without one.
   */
  label: string;

  /**
   * The rows the group holds, in order.
   */
  items: DashboardMenuItem[];
}

/**
 * Everything the dashboard needs to draw its sidebar and sheets for the signed-in user.
 */
export interface DashboardMeta {
  /**
   * The sidebar menu groups, resolved from `dashboard.menu` and filtered by the `dashboard:menu` hook.
   * Collection rows are scoped to what the user may reach; a declared link is not.
   */
  menu: DashboardMenuGroup[];

  /**
   * The collections the user may work with, in registry order.
   */
  collections: DashboardCollection[];

  /**
   * Every block type the listed collections and the account fields can reach, sorted by name.
   * A `blocks` field's `allow` resolves against this registry, nested fields included.
   */
  blocks: DashboardBlock[];

  /**
   * The roles the app declares, in registry order.
   */
  roles: DashboardRole[];

  /**
   * The capabilities the signed-in user holds, the union of their roles' grants.
   * Wildcards stay as declared, so a client matches with `hasCapability` rather than by equality.
   */
  capabilities: Capability[];

  /**
   * The ids of the routes the app serves, after `disable.routes` dropped any.
   * A client matches with `hasRoute`, which counts an any-method route for every method.
   */
  routes: string[];

  /**
   * The content locales the app declares.
   */
  locales: string[];

  /**
   * The locale an unspecified read or write addresses.
   */
  defaultLocale: string;

  /**
   * The languages the message catalogs define: the default language first, the rest in natural order.
   * The dashboard language setting picks from this list.
   */
  languages: string[];

  /**
   * The `Users` fields the signed-in user edits on the account page, described in layout order.
   * The `auth:account-layout` hook decides them; an empty list hides the page.
   */
  accountFields: DashboardField[];

  /**
   * How the account page arranges `accountFields`, resolved; empty when the page is hidden.
   */
  accountLayout: DashboardLayoutNode[];
}

declare module 'ohnejs' {
  interface Hooks {
    /**
     * Filters the sidebar menu after `dashboard.menu` resolves, before `GET /dashboard` answers.
     * Fires once per discovery read, inside the request context, so the viewer's language is in scope.
     * The groups arrive resolved: every row carries a `to`, a translated `label`, and any icon.
     * Append a group, reorder the rows, or drop a link the `context.user` should not see.
     * Collection rows are already scoped to what the user may reach; a declared link is not.
     * Return a replacement `DashboardMenuGroup[]`, or mutate the array in place and return nothing.
     */
    'dashboard:menu': (
      menu: DashboardMenuGroup[],
      context: { user: User; collections: readonly DashboardCollection[] },
    ) => void | DashboardMenuGroup[] | Promise<void | DashboardMenuGroup[]>;

    /**
     * Extends the discovery payload after everything else resolved, before `GET /dashboard` answers.
     * Fires once per read, inside the request context, so the viewer and their language are in scope.
     * Mutate the object in place; whatever it holds afterwards is the answer.
     * A layer types its key by augmenting `DashboardMeta` in `ohnejs/dashboard`, where the browser reads it.
     */
    'dashboard:meta': (meta: DashboardMeta, context: { user: User }) => void | Promise<void>;
  }
}

const DEFAULT_MENU: { label?: Message; items: DashboardMenuEntry[] }[] = [
  { items: [{ to: '/overview', label: 'dashboard.overview.title', icon: 'layout-dashboard' }] },
];

/**
 * `GET /dashboard`
 *
 * Describes the collections API for the signed-in user: the dashboard's one discovery read.
 * A collection appears when it is exposed and the user may run at least one of its operations.
 * Operations carry their verdicts, so the dashboard disables what the capability guard would refuse.
 * An operation whose route the app does not serve is closed, like one the collection does not expose.
 * `routes` lists the served route ids, so a layer's screen can hide a control whose route is dropped.
 * Fields carry the metadata a sheet needs: type, kind, flags, labels resolved in the request's language.
 * `languages` lists the catalog languages the dashboard language setting offers, the default first.
 * `accountFields` describes the `Users` fields the account page edits, as `auth:account-layout` places them.
 * A declared layout arrives resolved on its collection, block, or composite field, and on `accountLayout`.
 * No signed-in user is a `401`.
 */
export default defineHandler(async (): Promise<DashboardMeta> => {
  const user = await requireUser();
  const collections = describeCollections(user);
  const { locales, defaultLocale } = resolveLocales(useConfig().collections);
  const menu = await applyHook('dashboard:menu', resolveMenu(collections), { user, collections });
  const account = await describeAccount(user);
  const meta: DashboardMeta = {
    menu,
    collections,
    blocks: describeBlocks([
      ...collections.flatMap((collection) => collection.fields),
      ...account.accountFields,
    ]),
    roles: describeRoles(),
    capabilities: userCapabilities(user),
    routes: useRoutes().keys(),
    locales,
    defaultLocale,
    languages: catalogLanguages(),
    ...account,
  };
  await applyHook('dashboard:meta', meta, { user });
  return meta;
});

/**
 * The catalog languages: the default first, the rest in natural order.
 */
function catalogLanguages(): string[] {
  return uniqueArray([defaultLanguage(), ...useMessages().keys().sort(naturalCompare)]);
}

/**
 * Describes the account page: the `Users` fields its layout lets the user edit, and the layout resolved.
 * Both are empty without a `Users` collection, or once the `auth:account-layout` hook empties the layout.
 */
async function describeAccount(
  user: User,
): Promise<Pick<DashboardMeta, 'accountFields' | 'accountLayout'>> {
  const users = useCollections().get('Users');
  if (isUndefined(users)) return { accountFields: [], accountLayout: [] };
  const layout = await accountLayout(user);
  const names = accountFields(layout);
  const fields = describeFields(
    pick(queryMetadata('Users').fields, names),
    users.collection.fields,
  );
  return { accountFields: fields, accountLayout: resolveLayout(layout, fields) ?? [] };
}

/**
 * Describes every block type the root fields can reach, following `allow` to closure.
 * A block's own fields may admit further blocks, and a block may admit itself.
 * The walk is therefore a worklist over names already described, not a recursion into field trees.
 */
function describeBlocks(roots: readonly DashboardField[]): DashboardBlock[] {
  const described = new Map<string, DashboardBlock>();
  const pending: string[] = [];
  collectAllowed(roots, pending);
  while (!isEmpty(pending)) {
    const name = pending.pop() as string;
    if (described.has(name)) continue;
    const meta = useBlocks().get(name);
    if (isUndefined(meta)) continue;
    const fields = describeFields(blockQueryMetadata(name).fields, meta.block.fields);
    const block: DashboardBlock = { name, label: declaredLabelOf(name, meta.block.label), fields };
    const layout = resolveLayout(meta.block.dashboard?.layout, fields);
    if (!isUndefined(layout)) block.layout = layout;
    described.set(name, block);
    collectAllowed(fields, pending);
  }
  return [...described.values()].sort((left, right) => naturalCompare(left.name, right.name));
}

/**
 * Collects the block types the fields admit, walking a composite's subfields for nested ones.
 */
function collectAllowed(fields: readonly DashboardField[], into: string[]): void {
  for (const field of fields) {
    if (!isUndefined(field.allow)) into.push(...field.allow);
    if (!isUndefined(field.subfields)) collectAllowed(field.subfields, into);
  }
}

/**
 * Every registered role with its label and description resolved in the request's language.
 */
function describeRoles(): DashboardRole[] {
  return Object.values(useRoles().all()).map(({ name, role }) => {
    const described: DashboardRole = { name, label: declaredLabelOf(name, role.label) };
    if (!isUndefined(role.description)) described.description = resolveMessage(role.description);
    return described;
  });
}

/**
 * A file-named declaration's display label: its declared `label`, or the name sentence-cased.
 */
function declaredLabelOf(name: string, label: Message | undefined): string {
  return isUndefined(label) ? toSentenceCase(name) : resolveMessage(label);
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
