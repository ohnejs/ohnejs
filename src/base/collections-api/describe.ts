import type {
  AnyCollectionDefinition,
  Capability,
  CollectionAPI,
  CollectionQueryMeta,
  FieldLayout,
  FieldQueryMeta,
  LogicalType,
  Message,
  RecordLabel,
  Router,
} from 'ohnejs';
import type { ConditionObject, HTTPMethod, ResolvedLayoutNode } from 'ohnejs/utils';

import {
  createRouter,
  endpointOf,
  isExpandableDescription,
  isRecordLabelTemplate,
  queryMetadata,
  useCollections,
  useRoutes,
} from 'ohnejs';
import {
  isEmpty,
  isJSONValue,
  isNull,
  isString,
  isUndefined,
  resolveLayoutNodes,
  serializeCondition,
  templateFields,
  toKebabCase,
  toSentenceCase,
} from 'ohnejs/utils';

import type { IconName } from '../../utils/icon/icon-name.ts';
import type { User } from '../auth/types.ts';

import { isTranslatableEntry } from '../../ohne/query/metadata.ts';
import { landsWithoutInput } from '../../ohne/query/validate-when.ts';
import { userCan } from '../auth/capabilities.ts';

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

  /**
   * Whether the operation declares an `access` resolver, so its verdict can differ per row.
   * Static per collection, so it holds for every user and request.
   */
  scoped: boolean;
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
   * The display label: a message the dashboard translates where it renders, through `translateMessage`.
   * A system field's label is its catalog key; an undeclared one is the sentence-cased name.
   */
  label: Message;

  /**
   * The field's plain description, a message the dashboard translates where it renders.
   * Absent when none is declared, or when the declared one is expandable.
   */
  description?: Message;

  /**
   * The field's description when it starts collapsed behind a toggle; absent for the plain form.
   * Each text is a message the dashboard translates; an omitted toggle label is the catalog's key.
   */
  expandable?: {
    /**
     * The content, shown once expanded.
     * Markdown is supported.
     */
    text: Message;

    /**
     * The toggle's label while the content is collapsed.
     */
    showLabel: Message;

    /**
     * The toggle's label while the content is expanded.
     */
    hideLabel: Message;

    /**
     * Whether the content starts expanded.
     */
    expanded: boolean;
  };

  /**
   * The empty-input hint, a message the dashboard translates; absent when none is declared.
   */
  placeholder?: Message;

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
   * The field's `when` gate in condition object form; absent on an ungated field.
   */
  when?: ConditionObject;

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
   * The subfield a one-child composite sorts by, when its type names one.
   */
  orderBy?: string;

  /**
   * How the form arranges the subfields, resolved; child kinds that declare a `layout` only.
   */
  layout?: DashboardLayoutNode[];

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

  /**
   * The declared default sort, in query `order` form.
   */
  order?: readonly string[];
}

/**
 * One node of a resolved field layout, as the dashboard renders it.
 * Labels arrive as messages and widths split from their names, so the client parses nothing.
 * A name the host does not describe is already dropped, and so is any container that left empty.
 */
export type DashboardLayoutNode = ResolvedLayoutNode<Message>;

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
   * The display label: the declared `label`, or the sentence-cased collection name.
   */
  label: Message;

  /**
   * The Tabler icon the sidebar menu shows, as declared; absent when the collection declares none.
   * Validated at boot, so the name always resolves to a shape.
   */
  icon?: IconName;

  /**
   * The declared dashboard path a record opens at, its `[uuid]` token standing for the record.
   * Absent when the collection declares none, so a record opens in the editor under `/collections/`.
   */
  recordPath?: string;

  /**
   * The declared dashboard list-view defaults; absent when the collection declares none.
   */
  table?: DashboardTable;

  /**
   * How the record editor arranges the fields, resolved; absent when the collection declares no layout.
   */
  layout?: DashboardLayoutNode[];

  /**
   * Whether the collection has translatable fields, so reads and writes accept a `locale`.
   */
  translatable: boolean;

  /**
   * Whether the collection holds exactly one record, so its menu row opens the editor directly.
   */
  singleton: boolean;

  /**
   * Whether a duplicate can succeed as is, so the dashboard offers it.
   * Never on a collection that declares `duplicate: false`.
   * It can when the collection shapes its copies with a `duplicate` function.
   * Otherwise no required field may be one a copy leaves out.
   * A copy leaves out top-level `unique` fields, unreadable ones, and `copy: false` types.
   */
  duplicable: boolean;

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

const STRUCTURAL_OPTIONS: Readonly<Record<string, ReadonlySet<string>>> = {
  record: new Set(['collection', 'onDelete']),
  records: new Set(['collection', 'inverse', 'onDelete']),
  childOne: new Set(['fields', 'layout']),
  childMany: new Set(['fields', 'layout']),
  blocks: new Set(['allow']),
};

const ANY_RECORD = '/00000000-0000-0000-0000-000000000000';

const OPERATION_ROUTES: Readonly<
  Record<keyof DashboardOperations, readonly [method: HTTPMethod, suffix: string]>
> = {
  read: ['POST', '/query'],
  create: ['POST', ''],
  update: ['PATCH', ANY_RECORD],
  delete: ['DELETE', ANY_RECORD],
};

/**
 * Describes the collections API for `user`: every collection they may work with, in registry order.
 * A collection appears when it is exposed and the user may run at least one of its operations.
 * Operations carry their verdicts, so a client disables what the capability guard would refuse.
 * An operation whose route the app does not serve is closed, like one the collection does not expose.
 * Fields carry the metadata a sheet needs: type, kind, flags, and labels as messages the dashboard translates.
 * A declared layout arrives resolved on its collection or composite field.
 * `GET /dashboard` answers it as `collections`.
 */
export function describeCollections(user: User): DashboardCollection[] {
  const router = createRouter(Object.values(useRoutes().all()));
  const collections: DashboardCollection[] = [];
  for (const meta of Object.values(useCollections().all())) {
    const segment = toKebabCase(meta.name);
    const operations = describeOperations(meta.collection.api, meta.name, user, (operation) =>
      served(router, segment, operation),
    );
    if (isNull(operations)) continue;
    const query = queryMetadata(meta.name);
    const fields = describeFields(query.fields);
    const dashboard = meta.collection.dashboard;
    const collection: DashboardCollection = {
      name: meta.name,
      segment,
      label: declaredLabelOf(meta.name, meta.collection.label),
      translatable: query.translatable === true,
      singleton: query.singleton === true,
      duplicable: duplicableOf(meta.collection, query),
      operations,
      fields,
      labelFields: labelFieldsOf(dashboard?.recordLabel, fields),
    };
    const recordLabel = dashboard?.recordLabel;
    if (!isUndefined(recordLabel) && isRecordLabelTemplate(recordLabel)) {
      collection.labelTemplate = recordLabel;
    }
    if (!isUndefined(dashboard?.icon)) collection.icon = dashboard.icon;
    if (!isUndefined(dashboard?.recordPath)) collection.recordPath = dashboard.recordPath;
    if (!isUndefined(dashboard?.table)) collection.table = dashboard.table;
    const layout = resolveLayout(dashboard?.layout, fields);
    if (!isUndefined(layout)) collection.layout = layout;
    collections.push(collection);
  }
  return collections;
}

/**
 * Describes every field in order from its query metadata.
 */
export function describeFields(fields: Record<string, FieldQueryMeta>): DashboardField[] {
  return Object.entries(fields).map(([name, meta]) => describeField(name, meta));
}

/**
 * Resolves a declared layout for the wire: widths split, names outside `fields` dropped, labels as declared.
 * A row, card, or tab left empty drops with them; a layout left empty resolves to `undefined`.
 */
export function resolveLayout(
  layout: FieldLayout | undefined,
  fields: readonly DashboardField[],
): DashboardLayoutNode[] | undefined {
  if (isUndefined(layout)) return undefined;
  const nodes = resolveLayoutNodes(layout, new Set(fields.map((field) => field.name)));
  return isEmpty(nodes) ? undefined : nodes;
}

/**
 * Resolves a collection's operations for `user`, or `null` when none is usable.
 * `routed` answers whether the app serves an operation's route.
 */
function describeOperations(
  api: boolean | CollectionAPI | undefined,
  collection: string,
  user: User,
  routed: (operation: keyof DashboardOperations) => boolean,
): DashboardOperations | null {
  const operations = {
    read: describeOperation(api, 'read', collection, user, routed),
    create: describeOperation(api, 'create', collection, user, routed),
    update: describeOperation(api, 'update', collection, user, routed),
    delete: describeOperation(api, 'delete', collection, user, routed),
  };
  const usable = Object.values(operations).some((operation) => operation?.allowed);
  return usable ? operations : null;
}

/**
 * Resolves one operation's verdict: `public` admits anyone, otherwise the capability decides.
 * An operation the collection does not expose, or whose route the app does not serve, is `null`.
 */
function describeOperation(
  api: boolean | CollectionAPI | undefined,
  operation: keyof DashboardOperations,
  collection: string,
  user: User,
  routed: (operation: keyof DashboardOperations) => boolean,
): DashboardOperation | null {
  const endpoint = endpointOf(api, operation);
  if (isUndefined(endpoint) || !routed(operation)) return null;
  const open = endpoint.public === true;
  return {
    allowed: open || userCan(user, `collection.${collection}.${operation}` as Capability),
    public: open,
    scoped: !isUndefined(endpoint.access),
  };
}

/**
 * Whether the app serves an operation's collections-API route for the collection at `segment`.
 * It asks a router built like dispatch's, so the app's own route for that one collection counts too.
 */
function served(router: Router, segment: string, operation: keyof DashboardOperations): boolean {
  const [method, suffix] = OPERATION_ROUTES[operation];
  return router.match(method, `/collections/${segment}${suffix}`).type === 'matched';
}

/**
 * Describes one field: its type, shape and flags from the query metadata.
 */
function describeField(name: string, meta: FieldQueryMeta): DashboardField {
  const options = meta.options ?? {};
  const field: DashboardField = {
    name,
    type: meta.type ?? null,
    kind: meta.kind,
    label: labelOf(name, options.label),
    nullable: meta.nullable,
    required: requiredOf(meta),
    unique: options.unique === true,
    translatable: isTranslatableEntry(meta),
    readable: meta.readable !== false,
    writable: !isUndefined(meta.fieldType) && meta.writable !== false,
    immutable: meta.immutable === true,
  };
  if (!isUndefined(meta.logicalType)) field.logicalType = meta.logicalType;
  if (!isUndefined(meta.when)) field.when = serializeCondition(meta.when) as ConditionObject;
  const { description } = options;
  if (isExpandableDescription(description)) {
    const { text, showLabel, hideLabel, expanded = false } = description;
    field.expandable = {
      text,
      showLabel: 'dashboard.field.showDescription',
      hideLabel: 'dashboard.field.hideDescription',
      expanded,
    };
    if (!isUndefined(showLabel)) field.expandable.showLabel = showLabel;
    if (!isUndefined(hideLabel)) field.expandable.hideLabel = hideLabel;
  } else if (!isUndefined(description)) {
    field.description = description as Message;
  }
  if (!isUndefined(options.placeholder)) field.placeholder = options.placeholder as Message;
  const wire = wireOptions(meta, options);
  if (!isUndefined(wire)) field.options = wire;
  if (!isUndefined(meta.target)) field.target = meta.target;
  if (!isUndefined(meta.orderBy)) field.orderBy = meta.orderBy;
  if (!isUndefined(meta.subfields)) {
    field.subfields = describeFields(meta.subfields);
    const layout = resolveLayout(options.layout as FieldLayout | undefined, field.subfields);
    if (!isUndefined(layout)) field.layout = layout;
  }
  if (!isUndefined(meta.allow)) field.allow = meta.allow;
  return field;
}

/**
 * The declared options of one field as the wire carries them, or `undefined` when nothing ships.
 * Only the options the field type declares ship, plus a static `default` the editor seeds a new record from.
 * The common flags already ride as their own members.
 * Structural options other members describe - a composite's `fields`, a relation's target - stay out.
 * So does any value that is not plain JSON data, like a computed default.
 */
function wireOptions(
  meta: FieldQueryMeta,
  options: Readonly<Record<string, unknown>>,
): Record<string, unknown> | undefined {
  const structural = STRUCTURAL_OPTIONS[meta.kind];
  const wire: Record<string, unknown> = {};
  for (const name of [...Object.keys(meta.fieldType?.options ?? {}), 'default']) {
    if (structural?.has(name)) continue;
    const value = options[name];
    if (!isUndefined(value) && isJSONValue(value)) wire[name] = value;
  }
  return isEmpty(wire) ? undefined : wire;
}

/**
 * A file-named declaration's display label: its declared `label`, or the name sentence-cased.
 */
export function declaredLabelOf(name: string, label: Message | undefined): Message {
  return label ?? toSentenceCase(name);
}

/**
 * The field's display label: its declared `label`, a system field's catalog key, or the name sentence-cased.
 */
function labelOf(name: string, label: unknown): Message {
  if (!isUndefined(label)) return label as Message;
  if (name === 'UUID') return 'dashboard.fields.uuid.label';
  if (name === '_updatedAt') return 'dashboard.fields.updatedAt.label';
  if (name === '_translations') return 'dashboard.fields.translations.label';
  return toSentenceCase(name);
}

/**
 * Whether a duplicate can succeed without input, as `DashboardCollection.duplicable` states.
 */
function duplicableOf(collection: AnyCollectionDefinition, query: CollectionQueryMeta): boolean {
  if (query.singleton === true || query.duplicate === false) return false;
  if (!isUndefined(collection.duplicate)) return true;
  return !Object.values(query.fields).some(
    (field) =>
      requiredOf(field) &&
      (field.options?.unique === true ||
        field.readable === false ||
        field.fieldType?.copy === false),
  );
}

/**
 * Whether a create must provide the field.
 * System, framework-written, and gated fields never count; a field that lands without input fills itself.
 */
function requiredOf(meta: FieldQueryMeta): boolean {
  if (isUndefined(meta.fieldType) || meta.writable === false) return false;
  return isUndefined(meta.when) && !landsWithoutInput(meta);
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
