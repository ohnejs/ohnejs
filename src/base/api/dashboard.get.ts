import {
  applyHook,
  blockQueryMetadata,
  type Capability,
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
import { defaultLanguage } from '../../ohne/http/translate.ts';
import { accountFields, accountLayout } from '../auth/account-layout.ts';
import { userCapabilities } from '../auth/capabilities.ts';
import { requireUser } from '../auth/require-user.ts';
import { describeCollections, describeFields, resolveLayout } from '../collections-api/describe.ts';
import { resolveDashboardMenu } from '../menu/resolve-menu.ts';

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
   * The display label, a message the dashboard translates where it renders, through `translateMessage`.
   * It is the declared `label`, or the sentence-cased name when none is declared.
   */
  label: Message;

  /**
   * The declared `description`, a message the dashboard translates; absent when the block declares none.
   */
  description?: Message;

  /**
   * The block's icon, or the field whose value picks it; absent when the block declares none.
   */
  icon?: IconName | { field: string; map: Record<string, IconName>; default?: IconName };

  /**
   * The field whose value names one instance beside the label; absent when the block declares none.
   */
  titleField?: string;

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
   * The display label, a message the dashboard translates where it renders, through `translateMessage`.
   * It is the declared `label`, or the sentence-cased name when none is declared.
   */
  label: Message;

  /**
   * The declared `description`, a message the dashboard translates; absent when the role declares none.
   */
  description?: Message;
}

/**
 * One sidebar menu node, already resolved and pruned for the signed-in user.
 * A node with a `to` is a link; one without is a group, and a group always holds a node.
 * A root group is a sidebar section under its label; adjacent root links share one untitled section.
 */
export interface DashboardMenuItem {
  /**
   * The node's id in `dashboard.menu`, or the collection name for a collection's link.
   */
  id: string;

  /**
   * The node's text, a message the dashboard translates where it renders, through `translateMessage`.
   * `''` renders a root group without a heading.
   */
  label: Message;

  /**
   * The dashboard path the link opens; a collection's link points at its list route.
   * Absent on a group.
   */
  to?: string;

  /**
   * The Tabler icon shown before the label; absent when the node declares none.
   */
  icon?: IconName;

  /**
   * The nodes under this one, in order; absent when it holds none.
   */
  children?: DashboardMenuItem[];
}

/**
 * Everything the dashboard needs to draw its sidebar and sheets for the signed-in user.
 */
export interface DashboardMeta {
  /**
   * The sidebar's root nodes, in order: `dashboard.menu` resolved, then the `dashboard:menu` hook.
   * Only what the user may see arrives: a collection out of reach drops, and so does a node whose `can` they lack.
   */
  menu: DashboardMenuItem[];

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
     * Extends the discovery payload after everything else resolved, before `GET /dashboard` answers.
     * Fires once per read, inside the request context, so the viewer is in scope.
     * Put labels in as messages; the dashboard translates them where it renders.
     * Mutate the object in place; whatever it holds afterwards is the answer.
     * A layer types its key by augmenting `DashboardMeta` in `ohnejs/dashboard`, where the browser reads it.
     */
    'dashboard:meta': (meta: DashboardMeta, context: { user: User }) => void | Promise<void>;
  }
}

/**
 * `GET /dashboard`
 *
 * Describes the collections API for the signed-in user: the dashboard's one discovery read.
 * A collection appears when it is exposed and the user may run at least one of its operations.
 * Operations carry their verdicts, so the dashboard disables what the capability guard would refuse.
 * An operation whose route the app does not serve is closed, like one the collection does not expose.
 * `routes` lists the served route ids, so a layer's screen can hide a control whose route is dropped.
 * Fields carry the metadata a sheet needs: type, kind, flags, and labels as messages the dashboard translates.
 * Labels stay messages, so the answer is the same in every language and a language switch refetches nothing.
 * `languages` lists the catalog languages the dashboard language setting offers, the default first.
 * `accountFields` describes the `Users` fields the account page edits, as `auth:account-layout` places them.
 * A declared layout arrives resolved on its collection, block, or composite field, and on `accountLayout`.
 * No signed-in user is a `401`.
 */
export default defineHandler(async (): Promise<DashboardMeta> => {
  const user = await requireUser();
  const collections = describeCollections(user);
  const { locales, defaultLocale } = resolveLocales(useConfig().collections);
  const menu = await resolveDashboardMenu(user, collections);
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
    const { description, dashboard } = meta.block;
    const block: DashboardBlock = { name, label: declaredLabelOf(name, meta.block.label), fields };
    if (!isUndefined(description)) block.description = description;
    if (!isUndefined(dashboard?.icon)) block.icon = dashboard.icon;
    if (!isUndefined(dashboard?.titleField)) block.titleField = dashboard.titleField;
    const layout = resolveLayout(dashboard?.layout, fields);
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
 * Every registered role with its label and description as declared.
 */
function describeRoles(): DashboardRole[] {
  return Object.values(useRoles().all()).map(({ name, role }) => {
    const described: DashboardRole = { name, label: declaredLabelOf(name, role.label) };
    if (!isUndefined(role.description)) described.description = role.description;
    return described;
  });
}

/**
 * A file-named declaration's display label: its declared `label`, or the name sentence-cased.
 */
function declaredLabelOf(name: string, label: Message | undefined): Message {
  return label ?? toSentenceCase(name);
}
