import type { ConditionObject } from '../../utils/condition/condition-object.ts';
import type { MessageData } from '../../utils/i18n/message-data.ts';
import type { IconName } from '../../utils/icon/icon-name.ts';

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
  kind: 'column' | 'record' | 'records' | 'childOne' | 'childMany' | 'blocks' | 'translations';

  /**
   * The storage primitive of the field's column; column-bearing kinds (`column`, `record`) only.
   */
  logicalType?: 'text' | 'integer' | 'real' | 'boolean' | 'json';

  /**
   * The display label: a message the dashboard translates where it renders, through `translateMessage`.
   * A system field's label is its catalog key; an undeclared one is the sentence-cased name.
   */
  label: MessageData;

  /**
   * The field's plain description, a message the dashboard translates where it renders.
   * Absent when none is declared, or when the declared one is expandable.
   */
  description?: MessageData;

  /**
   * The field's description when it starts collapsed behind a toggle; absent for the plain form.
   * Each text is a message the dashboard translates; an omitted toggle label is the catalog's key.
   */
  expandable?: {
    /**
     * The content, shown once expanded.
     * Markdown is supported.
     */
    text: MessageData;

    /**
     * The toggle's label while the content is collapsed.
     */
    showLabel: MessageData;

    /**
     * The toggle's label while the content is expanded.
     */
    hideLabel: MessageData;

    /**
     * Whether the content starts expanded.
     */
    expanded: boolean;
  };

  /**
   * The empty-input hint, a message the dashboard translates; absent when none is declared.
   */
  placeholder?: MessageData;

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
 * A field the layout places, by name.
 * Mirrors the `GET /dashboard` response.
 */
export interface DashboardLayoutField {
  /**
   * The node kind.
   */
  kind: 'field';

  /**
   * The field name, one of the host's described fields.
   */
  name: string;

  /**
   * The declared width: a plain CSS length, a percentage, or `auto`; absent when the item declares none.
   */
  width?: string;
}

/**
 * Nodes side by side, sharing the container's width.
 */
export interface DashboardLayoutRow {
  /**
   * The node kind.
   */
  kind: 'row';

  /**
   * The entries, left to right; never empty.
   */
  nodes: DashboardLayoutNode[];
}

/**
 * A bordered group of nodes.
 */
export interface DashboardLayoutCard {
  /**
   * The node kind.
   */
  kind: 'card';

  /**
   * The header label, a message the dashboard translates; absent when the card declares none.
   */
  label?: MessageData;

  /**
   * Whether the viewer can collapse the card.
   */
  collapsible: boolean;

  /**
   * The nodes, top to bottom; never empty.
   */
  nodes: DashboardLayoutNode[];
}

/**
 * A set of tabs, one panel of nodes per tab.
 */
export interface DashboardLayoutTabs {
  /**
   * The node kind.
   */
  kind: 'tabs';

  /**
   * The tabs, left to right; never empty.
   */
  tabs: DashboardLayoutTab[];
}

/**
 * One tab of a `DashboardLayoutTabs` node.
 */
export interface DashboardLayoutTab {
  /**
   * The tab label, a message the dashboard translates.
   */
  label: MessageData;

  /**
   * The panel's nodes, top to bottom; never empty.
   */
  nodes: DashboardLayoutNode[];
}

/**
 * A horizontal rule between stacked nodes.
 */
export interface DashboardLayoutRule {
  /**
   * The node kind.
   */
  kind: 'rule';
}

/**
 * One node of a resolved field layout, as the dashboard renders it.
 * Labels arrive as messages and widths split from their names, so the client parses nothing.
 * A name the host does not describe is already dropped, and so is any container that left empty.
 */
export type DashboardLayoutNode =
  | DashboardLayoutField
  | DashboardLayoutRow
  | DashboardLayoutCard
  | DashboardLayoutTabs
  | DashboardLayoutRule;

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
 * One sidebar menu row: a link the dashboard draws, already resolved for the signed-in user.
 * A collection row and a declared page link arrive in the same shape, so the sidebar renders one kind.
 */
export interface DashboardMenuItem {
  /**
   * The dashboard path the row opens; a collection row points at its list route.
   */
  to: string;

  /**
   * The row label, a message the dashboard translates where it renders, through `translateMessage`.
   */
  label: MessageData;

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
   * The group heading, a message the dashboard translates; `''` renders the group without one.
   */
  label: MessageData;

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
