import type { MessageData } from '../i18n/message-data.ts';

/**
 * How a form arranges its fields: a list of layout nodes, top to bottom.
 * A node is a field name with an optional width, a row, a card, a set of tabs, or a `'---'` rule.
 * A field the layout does not name renders after it, in declaration order.
 * `TName` narrows the names to the fields the host declares.
 * `TLabel` is the label type of cards and tabs: a message on the server, a live text in the browser.
 *
 * @example
 * ```ts
 * const layout: FieldLayout = [
 *   { card: [{ row: ['firstName', 'lastName'] }, 'email | 50%'] },
 *   {
 *     tabs: [
 *       { label: 'app.posts.content', fields: ['title', 'body'] },
 *       { label: 'app.posts.seo', fields: ['slug | 40%', 'metaDescription'] },
 *     ],
 *   },
 *   '---',
 *   {
 *     card: {
 *       label: 'Internal',
 *       collapsible: true,
 *       fields: ['notes', 'pinned | auto'],
 *     },
 *   },
 * ]
 * ```
 */
export type FieldLayout<
  TName extends string = string,
  TLabel = MessageData,
> = readonly FieldLayoutNode<TName, TLabel>[];

/**
 * One node of a `FieldLayout`.
 */
export type FieldLayoutNode<TName extends string = string, TLabel = MessageData> =
  | FieldLayoutItem<TName>
  | FieldLayoutRow<TName, TLabel>
  | FieldLayoutCard<TName, TLabel>
  | FieldLayoutTabs<TName, TLabel>
  | FieldLayoutRule;

/**
 * A field by name, optionally followed by ` | ` and a width.
 * A width is a plain CSS length or percentage the field never grows past.
 * `auto` sizes the field to its content instead.
 * Inside a row the width shares the line; outside a row it still caps the stacked field.
 *
 * @example
 * ```ts
 * 'title'
 * 'price | 8rem'
 * 'slug | 50%'
 * 'published | auto'
 * ```
 */
export type FieldLayoutItem<TName extends string = string> = TName | `${TName} | ${string}`;

/**
 * A horizontal rule between stacked nodes.
 */
export type FieldLayoutRule = '---';

/**
 * Fields side by side, sharing the width of their container.
 * An entry is a field, a card, or a set of tabs; rows do not nest, and a rule cannot sit in one.
 * Under a narrow container the row stacks.
 */
export interface FieldLayoutRow<TName extends string = string, TLabel = MessageData> {
  /**
   * The row's entries, left to right.
   *
   * @example
   * ```ts
   * ['firstName', 'lastName']
   * ['countryCode | 6rem', 'phone']
   * [{ card: ['pinned'] }, 'archived | auto']
   * ```
   */
  row: readonly (
    | FieldLayoutItem<TName>
    | FieldLayoutCard<TName, TLabel>
    | FieldLayoutTabs<TName, TLabel>
  )[];
}

/**
 * A bordered group of nodes, with an optional header.
 * The shorthand form is the node list alone; the object form adds a label and a collapse toggle.
 */
export interface FieldLayoutCard<TName extends string = string, TLabel = MessageData> {
  /**
   * The card's nodes, or an object naming them under `fields`.
   *
   * @example
   * ```ts
   * ['comments', 'assignee']
   *
   * {
   *   label: 'app.posts.internal',
   *   collapsible: true,
   *   fields: [{ row: ['comments', 'assignee'] }, '---', 'history'],
   * }
   * ```
   */
  card: FieldLayout<TName, TLabel> | FieldLayoutCardOptions<TName, TLabel>;
}

/**
 * The object form of a card: its nodes, a header label, and a collapse toggle.
 */
export interface FieldLayoutCardOptions<TName extends string = string, TLabel = MessageData> {
  /**
   * The header text, shown muted above the fields.
   * Pass a message key to translate it per the viewer's language.
   * Omitted, the card has no header unless it is collapsible.
   *
   * @example
   * ```ts
   * 'Internal notes'
   * 'app.posts.internal'
   * { key: 'app.posts.step', params: { n: 2 } }
   * ```
   */
  label?: TLabel;

  /**
   * Whether the viewer can collapse the card.
   * A card always opens expanded; the toggle shows while the card is hovered or focused.
   *
   * @default
   * false
   */
  collapsible?: boolean;

  /**
   * The card's nodes, top to bottom.
   *
   * @example
   * ```ts
   * [{ row: ['publishedAt', 'author'] }, '---', 'notes']
   * ```
   */
  fields: FieldLayout<TName, TLabel>;
}

/**
 * A set of tabs, one panel of nodes per tab.
 * Every panel is built at once, so switching keeps each field's state.
 * A tab whose fields carry validation errors shows their count beside its label.
 */
export interface FieldLayoutTabs<TName extends string = string, TLabel = MessageData> {
  /**
   * The tabs, left to right; the first opens active.
   *
   * @example
   * ```ts
   * [
   *   { label: 'app.posts.content', fields: ['title', 'body'] },
   *   { label: 'SEO', fields: [{ row: ['metaTitle', 'metaDescription'] }] },
   * ]
   * ```
   */
  tabs: readonly FieldLayoutTab<TName, TLabel>[];
}

/**
 * One tab of a `FieldLayoutTabs` node.
 */
export interface FieldLayoutTab<TName extends string = string, TLabel = MessageData> {
  /**
   * The tab's label.
   * Pass a message key to translate it per the viewer's language.
   *
   * @example
   * ```ts
   * 'Address'
   * 'app.contacts.address'
   * ```
   */
  label: TLabel;

  /**
   * The tab's nodes, top to bottom.
   *
   * @example
   * ```ts
   * ['street | 40%', { row: ['zip | 8rem', 'city'] }]
   * ```
   */
  fields: FieldLayout<TName, TLabel>;
}
