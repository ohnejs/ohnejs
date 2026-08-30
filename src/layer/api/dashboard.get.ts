import {
  blockQueryMetadata,
  type Capability,
  type CollectionAPI,
  type CollectionEndpoint,
  defineHandler,
  type FieldInstance,
  type FieldQueryMeta,
  type LogicalType,
  type Message,
  queryMetadata,
  type RecordLabel,
  useBlocks,
  useCollections,
  useConfig,
  useRoles,
} from 'ohne';
import {
  isBoolean,
  isEmpty,
  isNull,
  isPlainObject,
  isString,
  isUndefined,
  naturalCompare,
  toKebabCase,
  toSentenceCase,
} from 'ohne/utils';

import type { IconName } from '../../utils/icon/icon-name.ts';
import type { User } from '../auth/types.ts';

import { resolveLocales } from '../../ohne/collections/resolve-locales.ts';
import { resolveMessage, translate } from '../../ohne/http/translate.ts';
import { userCan } from '../auth/capabilities.ts';
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
 * The four collections-API operations of one collection; a closed operation is `null`.
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
   */
  kind: FieldQueryMeta['kind'];

  /**
   * The storage primitive of the field's column; column-bearing kinds (`column`, `record`) only.
   */
  logicalType?: LogicalType;

  /**
   * The display label, resolved in the request's language.
   * A declared `label` resolves through the message catalogs; omitted falls back to the sentence-cased name.
   */
  label: string;

  /**
   * The field's description, resolved in the request's language; absent when none is declared.
   */
  description?: string;

  /**
   * Whether the field's value admits `null`.
   */
  nullable: boolean;

  /**
   * Whether a create must provide the field: non-nullable, no default, and user-written.
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
   * Whether an empty value is accepted; present only on field types that declare the option.
   */
  allowEmpty?: boolean;

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
   * Every addressable field in order: `UUID`, `_updatedAt`, then the declared fields as authored.
   */
  fields: DashboardField[];

  /**
   * The fields whose non-empty values, joined with single spaces in order, name a record.
   * The declared `recordLabel` as a list, or the first readable plain text field; empty without either.
   */
  labelFields: readonly string[];
}

/**
 * One block type a `blocks` field may hold, described for the dashboard's editors.
 *
 * Block types are named, never inlined.
 * A block may hold a `blocks` field allowing its own type, so the graph has cycles.
 * Only a flat registry keyed by name closes.
 * A field's `allow` names its members; every name it lists is described here.
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
 * One sidebar menu group: a heading and the collections it holds.
 */
export interface DashboardMenuGroup {
  /**
   * The group heading, resolved in the request's language; `''` renders the group without one.
   */
  label: string;

  /**
   * The collection names the group holds, in order.
   */
  collections: string[];
}

/**
 * Everything the dashboard needs to draw its sidebar and sheets for the signed-in user.
 */
export interface DashboardMeta {
  /**
   * The sidebar menu groups, resolved from `dashboard.menu` and filtered to accessible collections.
   */
  menu: DashboardMenuGroup[];

  /**
   * The collections the user may work with, in registry order.
   */
  collections: DashboardCollection[];

  /**
   * Every block type the listed collections can reach, sorted by name.
   * A `blocks` field's `allow` resolves against this registry, nested fields included.
   */
  blocks: DashboardBlock[];

  /**
   * The role names the app declares, in registry order.
   */
  roles: string[];

  /**
   * The content locales the app declares.
   */
  locales: string[];

  /**
   * The locale an unspecified read or write addresses.
   */
  defaultLocale: string;
}

/**
 * `GET /dashboard`
 *
 * Describes the collections API for the signed-in user: the dashboard's one discovery read.
 * A collection appears when it is exposed and the user may run at least one of its operations.
 * Operations carry their verdicts, so the dashboard disables what the capability guard would refuse.
 * Fields carry the metadata a sheet needs: type, kind, flags, labels resolved in the request's language.
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
    const collection: DashboardCollection = {
      name: meta.name,
      segment: toKebabCase(meta.name),
      label: toSentenceCase(meta.name),
      translatable: query.translatable === true,
      operations,
      fields,
      labelFields: labelFieldsOf(meta.collection.recordLabel, fields),
    };
    if (!isUndefined(meta.collection.icon)) collection.icon = meta.collection.icon;
    if (!isUndefined(meta.collection.table)) collection.table = meta.collection.table;
    collections.push(collection);
  }
  const { locales, defaultLocale } = resolveLocales(useConfig().collections);
  return {
    menu: resolveMenu(collections),
    collections,
    blocks: describeBlocks(collections),
    roles: useRoles().keys(),
    locales,
    defaultLocale,
  };
});

/**
 * Describes every block type the listed collections can reach, following `allow` to closure.
 * A block's own fields may admit further blocks, and a block may admit itself.
 * The walk is therefore a worklist over names already described, not a recursion into field trees.
 */
function describeBlocks(collections: readonly DashboardCollection[]): DashboardBlock[] {
  const described = new Map<string, DashboardBlock>();
  const pending: string[] = [];
  for (const collection of collections) collectAllowed(collection.fields, pending);
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
 * Resolves a collection's four operations for `user`, or `null` when none is usable.
 * A collection with no usable operation stays invisible, matching the API's identical `404`.
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
  if (isNull(endpoint)) return null;
  const open = endpoint.public === true;
  return {
    allowed: open || userCan(user, `collection.${collection}.${operation}` as Capability),
    public: open,
  };
}

/**
 * Resolves one operation's endpoint options from the `api` exposure, or `null` when closed.
 * Mirrors the collections-API gate, which keeps its resolution private.
 */
function endpointOf(
  api: boolean | CollectionAPI | undefined,
  operation: keyof DashboardOperations,
): CollectionEndpoint | null {
  if (isBoolean(api) || isUndefined(api)) return api === true ? {} : null;
  const value = api[operation];
  if (isBoolean(value) || isUndefined(value)) return value === true ? {} : null;
  return value === 'public' ? { public: true } : value;
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
  if (!isUndefined(options.description)) {
    field.description = resolveMessage(options.description as Message);
  }
  if (!isUndefined(options.allowEmpty)) field.allowEmpty = options.allowEmpty === true;
  if (!isUndefined(meta.target)) field.target = meta.target;
  if (!isUndefined(meta.subfields)) {
    field.subfields = describeFields(meta.subfields, subInstancesOf(instance));
  }
  if (!isUndefined(meta.allow)) field.allow = meta.allow;
  return field;
}

/**
 * The field's display label: its declared `label`, a system field's catalog key, or the name sentence-cased.
 */
function labelOf(name: string, label: unknown): string {
  if (!isUndefined(label)) return resolveMessage(label as Message);
  if (name === 'UUID') return translate('dashboard.fields.uuid.label');
  if (name === '_updatedAt') return translate('dashboard.fields.updatedAt.label');
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
 * The fallback is the first readable plain `text` column, never `UUID` or a password.
 */
function labelFieldsOf(
  declared: RecordLabel | undefined,
  fields: readonly DashboardField[],
): readonly string[] {
  if (!isUndefined(declared)) return isString(declared) ? [declared] : declared;
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
 */
function resolveMenu(collections: DashboardCollection[]): DashboardMenuGroup[] {
  const names = new Set(collections.map((collection) => collection.name));
  const groups: DashboardMenuGroup[] = [];
  for (const group of useConfig().dashboard?.menu ?? []) {
    const members = group.collections.filter((name) => names.has(name));
    for (const name of members) names.delete(name);
    if (!isEmpty(members)) {
      groups.push({
        label: isUndefined(group.label) ? '' : resolveMessage(group.label),
        collections: members,
      });
    }
  }
  if (names.size > 0) groups.push({ label: '', collections: [...names] });
  return groups;
}
