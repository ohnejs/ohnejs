import type { ConditionObject } from '../../utils/condition/condition-object.ts';
import type { ResolvedLayoutNode } from '../../utils/field-layout/resolve-layout-nodes.ts';
import type { MessageData } from '../../utils/i18n/message-data.ts';
import type { IconName } from '../../utils/icon/icon-name.ts';
import type { Text } from './text-type.ts';

/**
 * One exposed collections-API operation, as the signed-in user sees it.
 * Mirrors the `GET /dashboard` response.
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
 * A page form's `field` spec describes itself in the same shape, so one renderer serves both.
 * `O` types `options`, as a field type's own controls read them.
 */
export interface DashboardField<O = Record<string, unknown>> {
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
  kind: 'column' | 'record' | 'records' | 'childOne' | 'childMany' | 'blocks' | 'translations';

  /**
   * The storage primitive of the field's column; column-bearing kinds (`column`, `record`) only.
   */
  logicalType?: 'text' | 'integer' | 'real' | 'boolean' | 'json';

  /**
   * The display label, translated where it renders through `translateMessage`.
   * A system field's label is its catalog key; an undeclared one is the sentence-cased name.
   */
  label: Text;

  /**
   * The field's plain description, translated where it renders.
   * Absent when none is declared, or when the declared one is expandable.
   */
  description?: Text;

  /**
   * The field's description when it starts collapsed behind a toggle; absent for the plain form.
   * Each text is translated where it renders; an omitted toggle label is the catalog's key.
   */
  expandable?: {
    /**
     * The content, shown once expanded.
     * Markdown is supported.
     */
    text: Text;

    /**
     * The toggle's label while the content is collapsed.
     */
    showLabel: Text;

    /**
     * The toggle's label while the content is expanded.
     */
    hideLabel: Text;

    /**
     * Whether the content starts expanded.
     */
    expanded: boolean;
  };

  /**
   * The empty-input hint, translated where it renders; absent when none is declared.
   */
  placeholder?: Text;

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
   * A shipped option may still be missing, since non-JSON values stay home: hence `Partial`.
   */
  options?: Readonly<Partial<O>>;

  /**
   * The target collection name; relation kinds (`record`, `records`) only.
   */
  target?: string;

  /**
   * The child table's own fields, its item `UUID` included; child kinds only.
   */
  subfields?: DashboardField[];

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
 * Mirrors the `GET /dashboard` response.
 */
export interface DashboardTable {
  /**
   * The declared column entries, one `name|width|minWidth` string per column.
   */
  columns?: readonly string[];
}

/**
 * One node of a resolved field layout, as the dashboard renders it.
 * Labels stay as declared and widths split from their names, so the client parses nothing.
 * A name the host does not describe is already dropped, and so is any container that left empty.
 */
export type DashboardLayoutNode = ResolvedLayoutNode<Text>;

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
   * The display label, a message the dashboard translates where it renders, through `translateMessage`.
   * It is the declared `label`, or the sentence-cased name when none is declared.
   */
  label: MessageData;

  /**
   * The declared `description`, a message the dashboard translates; absent when the block declares none.
   */
  description?: MessageData;

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
  label: MessageData;

  /**
   * The declared `description`, a message the dashboard translates; absent when the role declares none.
   */
  description?: MessageData;
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
  label: MessageData;

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
   * A collection out of reach drops, and so does a node whose `can` the user lacks.
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
  capabilities: string[];

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
