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
 * Mirrors the `GET /dashboard` response.
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
  capabilities: string[];

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
