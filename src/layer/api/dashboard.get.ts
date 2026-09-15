import {
  applyHook,
  blockQueryMetadata,
  type Capability,
  type CollectionAPI,
  type DashboardMenuEntry,
  type DashboardMenuLink,
  defineHandler,
  endpointOf,
  type FieldInstance,
  type FieldQueryMeta,
  isExpandableDescription,
  isRecordLabelTemplate,
  type LogicalType,
  type Message,
  queryMetadata,
  type RecordLabel,
  useBlocks,
  useCollections,
  useConfig,
  useMessages,
  useRoles,
} from 'ohnejs';
import {
  isEmpty,
  isJSONValue,
  isNull,
  isPlainObject,
  isString,
  isUndefined,
  naturalCompare,
  pick,
  templateFields,
  toKebabCase,
  toSentenceCase,
  uniqueArray,
} from 'ohnejs/utils';

import type { IconName } from '../../utils/icon/icon-name.ts';
import type { User } from '../auth/types.ts';

import { resolveLocales } from '../../ohne/collections/resolve-locales.ts';
import { defaultLanguage, resolveMessage, translate } from '../../ohne/http/translate.ts';
import { accountFields } from '../auth/account-fields.ts';
import { userCan, userCapabilities } from '../auth/capabilities.ts';
import { requireUser } from '../auth/require-user.ts';

/**
 * One exposed collections-API operation, as the signed-in user sees it.
 */
export interface DashboardOperation {
  /**
   * Whether the user may run the operation: it is `public` or they hold its capability.
   * The operation's `access` resolver still decides per request, so an allowed call can answer `404`.
   */
  allowed: boolean;

  /**
   * Whether the operation is open to anonymous requests, skipping the capability guard.
   */
  public: boolean;
}

/**
 * The collections-API operations of one collection; a closed operation is `null`.
 */
export interface DashboardOperations {
  /**
   * The read exposure: the list, the by-`UUID` read, and the body-query `POST`.
   */
  read: DashboardOperation | null;

  /**
   * The create exposure.
   */
  create: DashboardOperation | null;

  /**
   * The update exposure.
   */
  update: DashboardOperation | null;

  /**
   * The delete exposure.
   */
  delete: DashboardOperation | null;
}

/**
 * One field of a collection, described for the dashboard's sheet view.
 */
export interface DashboardField {
  /**
   * The field name, as records carry it.
   */
  name: string;

  /**
   * The registered field type name, like `text` or `password`; `null` on the system fields.
   */
  type: string | null;

  /**
   * How the field stores and reads: a column, a relation, a child table, or a blocks wrapper.
   * `translations` is the read-only list of locales a translatable collection's record holds.
   */
  kind: FieldQueryMeta['kind'];

  /**
   * The storage primitive of the field's column; column-bearing kinds (`column`, `record`) only.
   */
  logicalType?: LogicalType;

  /**
   * The display label, resolved in the request's language.
   */
  label: string;

  /**
   * The field's plain description, resolved in the request's language.
   * Absent when none is declared, or when the declared one is expandable.
   */
  description?: string;

  /**
   * The field's description when it starts collapsed behind a toggle; absent for the plain form.
   * Every string is resolved in the request's language; an omitted toggle label takes the catalog's.
   */
  expandable?: {
    /**
     * The content, shown once expanded.
     * Markdown is supported.
     */
    text: string;

    /**
     * The toggle's label while the content is collapsed.
     */
    showLabel: string;

    /**
     * The toggle's label while the content is expanded.
     */
    hideLabel: string;

    /**
     * Whether the content starts expanded.
     */
    expanded: boolean;
  };

  /**
   * The empty-input hint, resolved in the request's language; absent when none is declared.
   */
  placeholder?: string;

  /**
   * Whether the field's value admits `null`.
   */
  nullable: boolean;

  /**
   * Whether a create must provide the field: column-bearing, non-nullable, no default, and user-written.
   */
  required: boolean;

  /**
   * Whether the field's value must be unique across the collection.
   */
  unique: boolean;

  /**
   * Whether the field holds one value per locale.
   */
  translatable: boolean;

  /**
   * Whether reads return the field; `false` marks a write-only field like a password.
   */
  readable: boolean;

  /**
   * Whether writes may set the field; `false` marks a framework-written field.
   */
  writable: boolean;

  /**
   * Whether the field locks after create.
   */
  immutable: boolean;

  /**
   * The field type's declared options as resolved, reduced to plain JSON data.
   * Structural options other members already describe, like a composite's `fields`, stay out.
   * Absent when nothing ships, so a plain field carries no empty object.
   */
  options?: Readonly<Record<string, unknown>>;

  /**
   * The target collection name; relation kinds (`record`, `records`) only.
   */
  target?: string;

  /**
   * The child table's own fields, its item `UUID` included; child kinds only.
   */
  subfields?: DashboardField[];

  /**
   * The block type names the field admits; `blocks` kind only.
   */
  allow?: readonly string[];
}

/**
 * A collection's declared dashboard list-view defaults.
 */
export interface DashboardTable {
  /**
   * The declared column entries, one `name|width|minWidth` string per column.
   */
  columns?: readonly string[];
}

/**
 * One collection the signed-in user may work with over the collections API.
 */
export interface DashboardCollection {
  /**
   * The registered collection name, in PascalCase; capability strings carry it.
   */
  name: string;

  /**
   * The collection's URL segment under `/collections/`, the kebab-case of its name.
   */
  segment: string;

  /**
   * The display label: the sentence-cased collection name.
   */
  label: string;

  /**
   * The Tabler icon the sidebar menu shows, as declared; absent when the collection declares none.
   * Validated at boot, so the name always resolves to a shape.
   */
  icon?: IconName;

  /**
   * The declared dashboard list-view defaults; absent when the collection declares none.
   */
  table?: DashboardTable;

  /**
   * Whether the collection has translatable fields, so reads and writes accept a `locale`.
   */
  translatable: boolean;

  /**
   * The collection's operations, each `null` when closed.
   */
  operations: DashboardOperations;

  /**
   * Every addressable field in order: the system entries, then the declared fields as authored.
   * The system entries are `UUID`, `_updatedAt`, and `_translations` on a translatable collection.
   */
  fields: DashboardField[];

  /**
   * The fields whose non-empty values, joined with single spaces in order, name a record.
   * The declared `recordLabel` as a list, a template's tokens, or the first readable plain text field.
   * Empty without any of those.
   */
  labelFields: readonly string[];

  /**
   * The declared label template, its `{field}` tokens over `labelFields`; absent for the joined form.
   * When present, the label renders from the template instead of the space-joined parts.
   */
  labelTemplate?: string;
}

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
   * The role names the app declares, in registry order.
   */
  roles: string[];

  /**
   * The capabilities the signed-in user holds, the union of their roles' grants.
   * Wildcards stay as declared, so a client matches with `hasCapability` rather than by equality.
   */
  capabilities: Capability[];

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
   * The `Users` fields the signed-in user edits on the account page, described in form order.
   * The `auth:account-fields` hook decides the list; an empty list hides the page.
   */
  accountFields: DashboardField[];
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
  }
}

const DEFAULT_MENU: { label?: Message; items: DashboardMenuEntry[] }[] = [
  { items: [{ to: '/overview', label: 'dashboard.overview.title', icon: 'layout-dashboard' }] },
];

const STRUCTURAL_OPTIONS: Readonly<Record<string, ReadonlySet<string>>> = {
  record: new Set(['collection', 'onDelete']),
  records: new Set(['collection', 'inverse', 'onDelete']),
  childOne: new Set(['fields']),
  childMany: new Set(['fields']),
  blocks: new Set(['allow']),
};

/**
 * `GET /dashboard`
 *
 * Describes the collections API for the signed-in user: the dashboard's one discovery read.
 * A collection appears when it is exposed and the user may run at least one of its operations.
 * Operations carry their verdicts, so the dashboard disables what the capability guard would refuse.
 * Fields carry the metadata a sheet needs: type, kind, flags, labels resolved in the request's language.
 * `languages` lists the catalog languages the dashboard language setting offers, the default first.
 * `accountFields` describes the `Users` fields the account page edits, as `auth:account-fields` allows.
 * No signed-in user is a `401`.
 */
export default defineHandler(async (): Promise<DashboardMeta> => {
  const user = await requireUser();
  const collections: DashboardCollection[] = [];
  for (const meta of Object.values(useCollections().all())) {
    const operations = describeOperations(meta.collection.api, meta.name, user);
    if (isNull(operations)) continue;
    const query = queryMetadata(meta.name);
    const fields = describeFields(query.fields, meta.collection.fields);
    const dashboard = meta.collection.dashboard;
    const collection: DashboardCollection = {
      name: meta.name,
      segment: toKebabCase(meta.name),
      label: toSentenceCase(meta.name),
      translatable: query.translatable === true,
      operations,
      fields,
      labelFields: labelFieldsOf(dashboard?.recordLabel, fields),
    };
    const recordLabel = dashboard?.recordLabel;
    if (!isUndefined(recordLabel) && isRecordLabelTemplate(recordLabel)) {
      collection.labelTemplate = recordLabel;
    }
    if (!isUndefined(dashboard?.icon)) collection.icon = dashboard.icon;
    if (!isUndefined(dashboard?.table)) collection.table = dashboard.table;
    collections.push(collection);
  }
  const { locales, defaultLocale } = resolveLocales(useConfig().collections);
  const menu = await applyHook('dashboard:menu', resolveMenu(collections), { user, collections });
  const account = await describeAccountFields(user);
  return {
    menu,
    collections,
    blocks: describeBlocks([...collections.flatMap((collection) => collection.fields), ...account]),
    roles: useRoles().keys(),
    capabilities: userCapabilities(user),
    locales,
    defaultLocale,
    languages: catalogLanguages(),
    accountFields: account,
  };
});

/**
 * The catalog languages: the default first, the rest in natural order.
 */
function catalogLanguages(): string[] {
  return uniqueArray([defaultLanguage(), ...useMessages().keys().sort(naturalCompare)]);
}

/**
 * Describes the `Users` fields the account page edits, in allowlist order; none without a `Users` collection.
 */
async function describeAccountFields(user: User): Promise<DashboardField[]> {
  const users = useCollections().get('Users');
  if (isUndefined(users)) return [];
  const allowed = pick(queryMetadata('Users').fields, await accountFields(user));
  return describeFields(allowed, users.collection.fields);
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
    described.set(name, { name, label: blockLabelOf(name, meta.block.label), fields });
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
 * The block's display label: its declared `label`, or the name sentence-cased.
 */
function blockLabelOf(name: string, label: Message | undefined): string {
  return isUndefined(label) ? toSentenceCase(name) : resolveMessage(label);
}

/**
 * Resolves a collection's operations for `user`, or `null` when none is usable.
 */
function describeOperations(
  api: boolean | CollectionAPI | undefined,
  collection: string,
  user: User,
): DashboardOperations | null {
  const operations = {
    read: describeOperation(api, 'read', collection, user),
    create: describeOperation(api, 'create', collection, user),
    update: describeOperation(api, 'update', collection, user),
    delete: describeOperation(api, 'delete', collection, user),
  };
  const usable = Object.values(operations).some((operation) => operation?.allowed);
  return usable ? operations : null;
}

/**
 * Resolves one operation's verdict: `public` admits anyone, otherwise the capability decides.
 */
function describeOperation(
  api: boolean | CollectionAPI | undefined,
  operation: keyof DashboardOperations,
  collection: string,
  user: User,
): DashboardOperation | null {
  const endpoint = endpointOf(api, operation);
  if (isUndefined(endpoint)) return null;
  const open = endpoint.public === true;
  return {
    allowed: open || userCan(user, `collection.${collection}.${operation}` as Capability),
    public: open,
  };
}

/**
 * Describes every field in order, joining the query metadata with the declared instances.
 */
function describeFields(
  fields: Record<string, FieldQueryMeta>,
  instances: Record<string, FieldInstance> | undefined,
): DashboardField[] {
  return Object.entries(fields).map(([name, meta]) => describeField(name, meta, instances?.[name]));
}

/**
 * Describes one field: identity from the instance, shape and flags from the query metadata.
 */
function describeField(
  name: string,
  meta: FieldQueryMeta,
  instance: FieldInstance | undefined,
): DashboardField {
  const options = meta.options ?? {};
  const field: DashboardField = {
    name,
    type: instance?.type ?? null,
    kind: meta.kind,
    label: labelOf(name, options.label),
    nullable: meta.nullable,
    required: requiredOf(meta, options),
    unique: options.unique === true,
    translatable: meta.companion === true || meta.localeScoped === true,
    readable: meta.readable !== false,
    writable: !isUndefined(meta.fieldType) && meta.writable !== false,
    immutable: meta.immutable === true,
  };
  if (!isUndefined(meta.logicalType)) field.logicalType = meta.logicalType;
  const { description } = options;
  if (isExpandableDescription(description)) {
    field.expandable = {
      text: resolveMessage(description.text),
      showLabel: resolveMessage(description.showLabel ?? 'dashboard.field.showDescription'),
      hideLabel: resolveMessage(description.hideLabel ?? 'dashboard.field.hideDescription'),
      expanded: description.expanded ?? false,
    };
  } else if (!isUndefined(description)) {
    field.description = resolveMessage(description as Message);
  }
  if (!isUndefined(options.placeholder)) {
    field.placeholder = resolveMessage(options.placeholder as Message);
  }
  const wire = wireOptions(meta, options);
  if (!isUndefined(wire)) field.options = wire;
  if (!isUndefined(meta.target)) field.target = meta.target;
  if (!isUndefined(meta.subfields)) {
    field.subfields = describeFields(meta.subfields, subInstancesOf(instance));
  }
  if (!isUndefined(meta.allow)) field.allow = meta.allow;
  return field;
}

/**
 * The declared options of one field as the wire carries them, or `undefined` when nothing ships.
 * Only options the field type declares ship; the common flags already ride as their own members.
 * Structural options other members describe - a composite's `fields`, a relation's target - stay out.
 * So does any value that is not plain JSON data, like a computed default.
 */
function wireOptions(
  meta: FieldQueryMeta,
  options: Readonly<Record<string, unknown>>,
): Record<string, unknown> | undefined {
  const declared = meta.fieldType?.options;
  if (isUndefined(declared)) return undefined;
  const structural = STRUCTURAL_OPTIONS[meta.kind];
  const wire: Record<string, unknown> = {};
  for (const name of Object.keys(declared)) {
    if (structural?.has(name)) continue;
    const value = options[name];
    if (!isUndefined(value) && isJSONValue(value)) wire[name] = value;
  }
  return isEmpty(wire) ? undefined : wire;
}

/**
 * The field's display label: its declared `label`, a system field's catalog key, or the name sentence-cased.
 */
function labelOf(name: string, label: unknown): string {
  if (!isUndefined(label)) return resolveMessage(label as Message);
  if (name === 'UUID') return translate('dashboard.fields.uuid.label');
  if (name === '_updatedAt') return translate('dashboard.fields.updatedAt.label');
  if (name === '_translations') return translate('dashboard.fields.translations.label');
  return toSentenceCase(name);
}

/**
 * Whether a create must provide the field.
 * System and framework-written fields never count; a default or a nullable column fills itself.
 */
function requiredOf(meta: FieldQueryMeta, options: Readonly<Record<string, unknown>>): boolean {
  if (meta.kind !== 'column' && meta.kind !== 'record') return false;
  if (isUndefined(meta.fieldType) || meta.writable === false) return false;
  if (meta.nullable) return false;
  return isUndefined(options.default) && isUndefined(meta.fieldType.defaultValue);
}

/**
 * The composite instance's declared subfield instances, when it carries a `fields` option.
 */
function subInstancesOf(
  instance: FieldInstance | undefined,
): Record<string, FieldInstance> | undefined {
  const fields = (instance?.options as Record<string, unknown> | undefined)?.fields;
  return isPlainObject<Record<string, FieldInstance>>(fields) ? fields : undefined;
}

/**
 * The fields that name a record: the declared `recordLabel` as a list, or the first plain text field.
 * A declared template contributes its `{field}` tokens in order.
 * The fallback is the first readable plain `text` column, never `UUID` or a password.
 */
function labelFieldsOf(
  declared: RecordLabel | undefined,
  fields: readonly DashboardField[],
): readonly string[] {
  if (!isUndefined(declared)) {
    if (isRecordLabelTemplate(declared)) return templateFields(declared) ?? [];
    return isString(declared) ? [declared] : declared;
  }
  const fallback = fields.find(
    (field) =>
      field.readable &&
      field.kind === 'column' &&
      field.logicalType === 'text' &&
      field.type !== 'password' &&
      field.name !== 'UUID',
  );
  return isUndefined(fallback) ? [] : [fallback.name];
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
