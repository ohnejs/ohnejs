import type { Message } from '../messages/known-messages.ts';

import {
  coerceToString,
  didYouMean,
  hasKey,
  isArray,
  isBoolean,
  isCSSLength,
  isEmpty,
  isMessage,
  isPlainObject,
  isString,
  isUndefined,
} from '../../utils/index.ts';
import { ohneError } from '../error/ohne-error.ts';

/**
 * How a form arranges its fields: a list of layout nodes, top to bottom.
 * A node is a field name with an optional width, a row, a card, a set of tabs, or a `'---'` rule.
 * A field the layout does not name renders after it, in declaration order.
 * `TField` narrows the names to the fields the host declares.
 *
 * @example
 * ```ts
 * layout: [
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
export type FieldLayout<TField extends string = string> = readonly FieldLayoutNode<TField>[];

/**
 * One node of a `FieldLayout`.
 */
export type FieldLayoutNode<TField extends string = string> =
  | FieldLayoutItem<TField>
  | FieldLayoutRow<TField>
  | FieldLayoutCard<TField>
  | FieldLayoutTabs<TField>
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
export type FieldLayoutItem<TField extends string = string> = TField | `${TField} | ${string}`;

/**
 * A horizontal rule between stacked nodes.
 */
export type FieldLayoutRule = '---';

/**
 * Fields side by side, sharing the width of their container.
 * An entry is a field, a card, or a set of tabs; rows do not nest, and a rule cannot sit in one.
 * Under a narrow container the row stacks.
 */
export interface FieldLayoutRow<TField extends string = string> {
  /**
   * The row's entries, left to right.
   *
   * @example
   * ```ts
   * row: ['firstName', 'lastName']
   * row: ['countryCode | 6rem', 'phone']
   * row: [{ card: ['pinned'] }, 'archived | auto']
   * ```
   */
  row: readonly (FieldLayoutItem<TField> | FieldLayoutCard<TField> | FieldLayoutTabs<TField>)[];
}

/**
 * A bordered group of nodes, with an optional header.
 * The shorthand form is the node list alone; the object form adds a label and a collapse toggle.
 */
export interface FieldLayoutCard<TField extends string = string> {
  /**
   * The card's nodes, or an object naming them under `fields`.
   *
   * @example
   * ```ts
   * card: ['comments', 'assignee']
   *
   * card: {
   *   label: 'app.posts.internal',
   *   collapsible: true,
   *   fields: [{ row: ['comments', 'assignee'] }, '---', 'history'],
   * }
   * ```
   */
  card: FieldLayout<TField> | FieldLayoutCardOptions<TField>;
}

/**
 * The object form of a card: its nodes, a header label, and a collapse toggle.
 */
export interface FieldLayoutCardOptions<TField extends string = string> {
  /**
   * The header text, shown muted above the fields.
   * Pass a message key to translate it per the viewer's language.
   * Omitted, the card has no header unless it is collapsible.
   *
   * @example
   * ```ts
   * label: 'Internal notes'
   * label: 'app.posts.internal'
   * label: { key: 'app.posts.step', params: { n: 2 } }
   * ```
   */
  label?: Message;

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
   * fields: [{ row: ['publishedAt', 'author'] }, '---', 'notes']
   * ```
   */
  fields: FieldLayout<TField>;
}

/**
 * A set of tabs, one panel of nodes per tab.
 * Every panel is built at once, so switching keeps each field's state.
 * A tab whose fields carry validation errors shows their count beside its label.
 */
export interface FieldLayoutTabs<TField extends string = string> {
  /**
   * The tabs, left to right; the first opens active.
   *
   * @example
   * ```ts
   * tabs: [
   *   { label: 'app.posts.content', fields: ['title', 'body'] },
   *   { label: 'SEO', fields: [{ row: ['metaTitle', 'metaDescription'] }] },
   * ]
   * ```
   */
  tabs: readonly FieldLayoutTab<TField>[];
}

/**
 * One tab of a `FieldLayoutTabs` node.
 */
export interface FieldLayoutTab<TField extends string = string> {
  /**
   * The tab's label.
   * Pass a message key to translate it per the viewer's language.
   *
   * @example
   * ```ts
   * label: 'Address'
   * label: 'app.contacts.address'
   * ```
   */
  label: Message;

  /**
   * The tab's nodes, top to bottom.
   *
   * @example
   * ```ts
   * fields: ['street | 40%', { row: ['zip | 8rem', 'city'] }]
   * ```
   */
  fields: FieldLayout<TField>;
}

interface LayoutContext {
  option: string;
  scope: string;
  names: readonly string[];
  seen: Set<string>;
}

const NODE_KEYS = new Set(['row', 'card', 'tabs']);
const CARD_KEYS = new Set(['label', 'collapsible', 'fields']);
const TAB_KEYS = new Set(['label', 'fields']);

/**
 * Splits a layout item into its field name and width.
 * The width is whatever follows the `|`, trimmed; an item without one has no `width`.
 *
 * @example
 * ```ts
 * parseLayoutItem('title')        // -> { name: 'title' }
 * parseLayoutItem('price | 8rem') // -> { name: 'price', width: '8rem' }
 * ```
 */
export function parseLayoutItem(item: string): { name: string; width?: string } {
  const [name = '', width] = item.split('|').map((part) => part.trim());
  return isUndefined(width) || width === '' ? { name } : { name, width };
}

/**
 * The field names a layout places, in reading order.
 * Rows read left to right; cards and tabs read top to bottom, every tab's panel included.
 *
 * @example
 * ```ts
 * layoutFieldNames([{ row: ['firstName', 'lastName'] }, '---', 'email | 50%'])
 * // -> ['firstName', 'lastName', 'email']
 * ```
 */
export function layoutFieldNames(layout: FieldLayout): string[] {
  const names: string[] = [];
  const walk = (nodes: FieldLayout): void => {
    for (const node of nodes) {
      if (isString(node)) {
        if (node !== '---') names.push(parseLayoutItem(node).name);
      } else if ('row' in node) {
        walk(node.row);
      } else if ('card' in node) {
        walk('fields' in node.card ? node.card.fields : node.card);
      } else {
        for (const tab of node.tabs) walk(tab.fields);
      }
    }
  };
  walk(layout);
  return names;
}

/**
 * Rejects a malformed `layout` declaration.
 *
 * - The layout is a non-empty array of nodes.
 * - A string node is `'---'`, a declared field name, or `name | width`.
 * - A width is a plain CSS length, a percentage, or `auto`.
 * - An object node holds exactly one of `row`, `card`, or `tabs`.
 * - A row is a non-empty list of fields, cards, or tabs; rows do not nest, and a rule cannot sit in one.
 * - A card is a non-empty node list, or an object with a non-empty `fields` list.
 * - A card object may add a `label` and a `collapsible` flag.
 * - Tabs are a non-empty list of `{ label, fields }` entries, each `fields` non-empty.
 * - A field name appears at most once; an unknown name suggests the nearest declared one.
 *
 * `option` names the declaration in messages, like `dashboard.layout`.
 * `scope` locates it with a leading space, like `` in collection `Posts` ``; `''` when unknown.
 */
export function validateLayout(
  layout: unknown,
  fieldNames: readonly string[],
  option: string,
  scope: string,
): void {
  if (isUndefined(layout)) return;
  if (!isArray(layout)) {
    throw ohneError({
      title: `Invalid \`${option}\` declaration`,
      body: [
        `The \`${option}\` option${scope} must be an array of layout nodes.`,
        "Write `layout: [{ row: ['firstName', 'lastName'] }, 'email']`.",
      ],
    });
  }
  if (isEmpty(layout)) {
    throw ohneError({
      title: `The \`${option}\` list is empty`,
      body: [
        `An empty \`${option}\`${scope} would silently stack the fields in declaration order.`,
        'Omit the key instead.',
      ],
    });
  }
  validateNodes(layout, false, { option, scope, names: fieldNames, seen: new Set() });
}

/**
 * Validates a node list: each entry is a string item or an object holding one of `row`, `card`, or `tabs`.
 */
function validateNodes(nodes: readonly unknown[], inRow: boolean, ctx: LayoutContext): void {
  for (const node of nodes) {
    if (isString(node)) {
      validateItem(node, inRow, ctx);
      continue;
    }
    if (!isPlainObject(node)) {
      throw ohneError({
        title: `Invalid \`${ctx.option}\` node`,
        body: [
          `A node${ctx.scope} is \`${coerceToString(node)}\`, which is neither a string nor an object.`,
          "A node is a field name, `'---'`, or an object holding one of `row`, `card`, or `tabs`.",
        ],
      });
    }
    const keys = Object.keys(node);
    if (keys.length !== 1 || !NODE_KEYS.has(keys[0] as string)) {
      const listed = isEmpty(keys) ? 'no keys' : keys.map((key) => `\`${key}\``).join(', ');
      throw ohneError({
        title: `Invalid \`${ctx.option}\` node`,
        body: [
          `A node${ctx.scope} holds ${listed}.`,
          'A node object holds exactly one of `row`, `card`, or `tabs`.',
        ],
      });
    }
    if (hasKey(node, 'row')) validateRow(node.row, inRow, ctx);
    else if (hasKey(node, 'card')) validateCard(node.card, ctx);
    else validateTabs(node.tabs, ctx);
  }
}

/**
 * Validates a string node: a rule outside a row, or a declared field named once with a legal width.
 */
function validateItem(item: string, inRow: boolean, ctx: LayoutContext): void {
  if (item === '---') {
    if (!inRow) return;
    throw ohneError({
      title: `A \`${ctx.option}\` row holds a rule`,
      body: [`A \`'---'\` rule${ctx.scope} separates stacked nodes, so it cannot sit in a row.`],
    });
  }
  const [name = '', ...rest] = item.split('|').map((part) => part.trim());
  if (name === '') {
    throw ohneError({
      title: `A \`${ctx.option}\` entry names no field`,
      body: [`Every \`${ctx.option}\` entry${ctx.scope} must start with a field name.`],
    });
  }
  if (rest.length > 1) {
    throw ohneError({
      title: `Invalid \`${ctx.option}\` entry \`${item}\``,
      body: [`An entry${ctx.scope} is \`name\` or \`name | width\`.`],
    });
  }
  if (!ctx.names.includes(name)) {
    const near = didYouMean(name, ctx.names);
    throw ohneError({
      title: `\`${ctx.option}\` references unknown field \`${name}\``,
      body: [
        `No field \`${name}\` is declared${ctx.scope}.`,
        ...(isUndefined(near) ? [] : [`Did you mean \`${near}\`?`]),
      ],
    });
  }
  if (ctx.seen.has(name)) {
    throw ohneError({
      title: `\`${ctx.option}\` repeats field \`${name}\``,
      body: [
        `A field renders once${ctx.scope}.`,
        'Two controls over one value cannot stay in sync.',
      ],
    });
  }
  ctx.seen.add(name);
  const [width] = rest;
  if (isUndefined(width) || width === '' || width === 'auto' || isCSSLength(width)) return;
  throw ohneError({
    title: `Invalid \`${ctx.option}\` width \`${width}\``,
    body: [
      `A width${ctx.scope} is a plain CSS length or percentage, like \`8rem\` or \`50%\`, or \`auto\`.`,
    ],
  });
}

/**
 * Validates a `row` value: a non-empty list of fields, cards, or tabs, never inside another row.
 */
function validateRow(row: unknown, inRow: boolean, ctx: LayoutContext): void {
  if (inRow) {
    throw ohneError({
      title: `A \`${ctx.option}\` row nests a row`,
      body: [`Rows${ctx.scope} do not nest.`, 'Put the inner fields directly in the outer row.'],
    });
  }
  if (!isArray(row) || isEmpty(row)) {
    throw ohneError({
      title: `Invalid \`${ctx.option}\` row`,
      body: [`A row${ctx.scope} must be a non-empty array of fields, cards, or tabs.`],
    });
  }
  validateNodes(row, true, ctx);
}

/**
 * Validates a `card` value: a non-empty node list, or an object with `fields`, `label`, and `collapsible`.
 */
function validateCard(card: unknown, ctx: LayoutContext): void {
  if (isArray(card)) {
    if (isEmpty(card)) invalidCard(ctx);
    validateNodes(card, false, ctx);
    return;
  }
  if (!isPlainObject(card)) invalidCard(ctx);
  for (const key of Object.keys(card)) {
    if (CARD_KEYS.has(key)) continue;
    throw ohneError({
      title: `Unknown \`${ctx.option}\` card key \`${key}\``,
      body: ['The keys are `label`, `collapsible`, and `fields`.'],
    });
  }
  validateLabel(card.label, 'card', ctx);
  if (!isUndefined(card.collapsible) && !isBoolean(card.collapsible)) {
    throw ohneError({
      title: `Invalid \`${ctx.option}\` card \`collapsible\` flag`,
      body: [`\`collapsible\`${ctx.scope} must be a boolean.`],
    });
  }
  if (!isArray(card.fields) || isEmpty(card.fields)) invalidCard(ctx);
  validateNodes(card.fields, false, ctx);
}

/**
 * The failure for a `card` value of the wrong shape.
 */
function invalidCard(ctx: LayoutContext): never {
  throw ohneError({
    title: `Invalid \`${ctx.option}\` card`,
    body: [
      `A card${ctx.scope} is a non-empty array of nodes, or an object with a non-empty \`fields\` array.`,
    ],
  });
}

/**
 * Validates a `tabs` value: a non-empty list of `{ label, fields }` entries with non-empty fields.
 */
function validateTabs(tabs: unknown, ctx: LayoutContext): void {
  if (!isArray(tabs) || isEmpty(tabs)) invalidTabs(ctx);
  for (const tab of tabs) {
    if (!isPlainObject(tab)) invalidTabs(ctx);
    for (const key of Object.keys(tab)) {
      if (TAB_KEYS.has(key)) continue;
      throw ohneError({
        title: `Unknown \`${ctx.option}\` tab key \`${key}\``,
        body: ['The keys are `label` and `fields`.'],
      });
    }
    if (isUndefined(tab.label)) {
      throw ohneError({
        title: `A \`${ctx.option}\` tab has no label`,
        body: [`Every tab${ctx.scope} needs a \`label\`.`],
      });
    }
    validateLabel(tab.label, 'tab', ctx);
    if (!isArray(tab.fields) || isEmpty(tab.fields)) {
      throw ohneError({
        title: `A \`${ctx.option}\` tab has no fields`,
        body: [`Every tab${ctx.scope} needs a non-empty \`fields\` array.`],
      });
    }
    validateNodes(tab.fields, false, ctx);
  }
}

/**
 * The failure for a `tabs` value of the wrong shape.
 */
function invalidTabs(ctx: LayoutContext): never {
  throw ohneError({
    title: `Invalid \`${ctx.option}\` tabs`,
    body: [`\`tabs\`${ctx.scope} must be a non-empty array of \`{ label, fields }\` entries.`],
  });
}

/**
 * Validates an optional label: a message key, a plain string, or a `{ key, params }` object.
 */
function validateLabel(label: unknown, what: string, ctx: LayoutContext): void {
  if (isUndefined(label) || isMessage(label)) return;
  throw ohneError({
    title: `Invalid \`${ctx.option}\` ${what} label`,
    body: [
      `A ${what} label${ctx.scope} is a message key, a plain string, or a \`{ key, params }\` object.`,
    ],
  });
}
