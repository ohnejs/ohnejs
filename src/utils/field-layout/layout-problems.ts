import { coerceToString } from '../coerce/coerce-to-string.ts';
import { didYouMean } from '../did-you-mean/did-you-mean.ts';
import { isMessage } from '../i18n/is-message.ts';
import { isArray } from '../is/is-array.ts';
import { isBoolean } from '../is/is-boolean.ts';
import { isCSSLength } from '../is/is-css-length.ts';
import { isEmpty } from '../is/is-empty.ts';
import { isPlainObject } from '../is/is-plain-object.ts';
import { isString } from '../is/is-string.ts';
import { isUndefined } from '../is/is-undefined.ts';
import { hasKey } from '../object/has-key.ts';

/**
 * One way a layout declaration is malformed, worded for an error block.
 */
export interface LayoutProblem {
  /**
   * The headline, naming the offending node or value in backticks.
   */
  title: string;

  /**
   * The cause, then the fix, one row per element.
   */
  body: string[];
}

/**
 * Options for `layoutProblems`.
 */
export interface LayoutProblemsOptions {
  /**
   * The name of the declaration in messages.
   *
   * @default
   * 'layout'
   */
  option?: string;

  /**
   * Where the declaration lives, with a leading space, like `` in collection `Posts` ``.
   *
   * @default
   * ''
   */
  scope?: string;

  /**
   * Whether a card or tab label has a legal shape.
   * A host whose labels are not plain messages, like live text getters, passes its own check.
   *
   * @default
   * isMessage
   */
  isLabel?: (label: unknown) => boolean;
}

interface LayoutContext {
  option: string;
  scope: string;
  names: readonly string[];
  seen: Set<string>;
  isLabel: (label: unknown) => boolean;
  problems: LayoutProblem[];
}

const NODE_KEYS = new Set(['row', 'card', 'tabs']);
const CARD_KEYS = new Set(['label', 'collapsible', 'fields']);
const TAB_KEYS = new Set(['label', 'fields']);

/**
 * Finds every way a `layout` declaration is malformed, in reading order; `[]` when it is sound.
 * An omitted layout is sound.
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
 * A malformed container reports once and is not entered, so one mistake never cascades.
 *
 * @example
 * ```ts
 * layoutProblems([{ row: ['title', 'slug'] }], ['title', 'slug'])
 * // -> []
 *
 * layoutProblems(['title', 'title'], ['title'])
 * // -> [{ title: '`layout` repeats field `title`', body: [...] }]
 *
 * layoutProblems(['titel'], ['title'], { scope: ' in collection `Posts`' })[0]?.body
 * // -> ['No field `titel` is declared in collection `Posts`.', 'Did you mean `title`?']
 * ```
 */
export function layoutProblems(
  layout: unknown,
  fieldNames: readonly string[],
  options: LayoutProblemsOptions = {},
): LayoutProblem[] {
  const { option = 'layout', scope = '', isLabel = isMessage } = options;
  const problems: LayoutProblem[] = [];
  if (isUndefined(layout)) return problems;
  if (!isArray(layout)) {
    problems.push({
      title: `Invalid \`${option}\` declaration`,
      body: [
        `The \`${option}\` option${scope} must be an array of layout nodes.`,
        "Write `layout: [{ row: ['firstName', 'lastName'] }, 'email']`.",
      ],
    });
  } else if (isEmpty(layout)) {
    problems.push({
      title: `The \`${option}\` list is empty`,
      body: [
        `An empty \`${option}\`${scope} would silently stack the fields in declaration order.`,
        'Omit the key instead.',
      ],
    });
  } else {
    const ctx = { option, scope, names: fieldNames, seen: new Set<string>(), isLabel, problems };
    checkNodes(layout, false, ctx);
  }
  return problems;
}

/**
 * Checks a node list: each entry is a string item or an object holding one of `row`, `card`, or `tabs`.
 */
function checkNodes(nodes: readonly unknown[], inRow: boolean, ctx: LayoutContext): void {
  for (const node of nodes) {
    if (isString(node)) {
      checkItem(node, inRow, ctx);
    } else if (!isPlainObject(node)) {
      ctx.problems.push({
        title: `Invalid \`${ctx.option}\` node`,
        body: [
          `A node${ctx.scope} is \`${coerceToString(node)}\`, which is neither a string nor an object.`,
          "A node is a field name, `'---'`, or an object holding one of `row`, `card`, or `tabs`.",
        ],
      });
    } else {
      const keys = Object.keys(node);
      if (keys.length !== 1 || !NODE_KEYS.has(keys[0] as string)) {
        const listed = isEmpty(keys) ? 'no keys' : keys.map((key) => `\`${key}\``).join(', ');
        ctx.problems.push({
          title: `Invalid \`${ctx.option}\` node`,
          body: [
            `A node${ctx.scope} holds ${listed}.`,
            'A node object holds exactly one of `row`, `card`, or `tabs`.',
          ],
        });
      } else if (hasKey(node, 'row')) checkRow(node.row, inRow, ctx);
      else if (hasKey(node, 'card')) checkCard(node.card, ctx);
      else checkTabs(node.tabs, ctx);
    }
  }
}

/**
 * Checks a string node: a rule outside a row, or a declared field named once with a legal width.
 */
function checkItem(item: string, inRow: boolean, ctx: LayoutContext): void {
  if (item === '---') {
    if (!inRow) return;
    ctx.problems.push({
      title: `A \`${ctx.option}\` row holds a rule`,
      body: [`A \`'---'\` rule${ctx.scope} separates stacked nodes, so it cannot sit in a row.`],
    });
    return;
  }
  const [name = '', ...rest] = item.split('|').map((part) => part.trim());
  if (name === '') {
    ctx.problems.push({
      title: `A \`${ctx.option}\` entry names no field`,
      body: [`Every \`${ctx.option}\` entry${ctx.scope} must start with a field name.`],
    });
    return;
  }
  if (rest.length > 1) {
    ctx.problems.push({
      title: `Invalid \`${ctx.option}\` entry \`${item}\``,
      body: [`An entry${ctx.scope} is \`name\` or \`name | width\`.`],
    });
    return;
  }
  if (!ctx.names.includes(name)) {
    const near = didYouMean(name, ctx.names);
    ctx.problems.push({
      title: `\`${ctx.option}\` references unknown field \`${name}\``,
      body: [
        `No field \`${name}\` is declared${ctx.scope}.`,
        ...(isUndefined(near) ? [] : [`Did you mean \`${near}\`?`]),
      ],
    });
    return;
  }
  if (ctx.seen.has(name)) {
    ctx.problems.push({
      title: `\`${ctx.option}\` repeats field \`${name}\``,
      body: [
        `A field renders once${ctx.scope}.`,
        'Two controls over one value cannot stay in sync.',
      ],
    });
    return;
  }
  ctx.seen.add(name);
  const [width] = rest;
  if (isUndefined(width) || width === '' || width === 'auto' || isCSSLength(width)) return;
  ctx.problems.push({
    title: `Invalid \`${ctx.option}\` width \`${width}\``,
    body: [
      `A width${ctx.scope} is a plain CSS length or percentage, like \`8rem\` or \`50%\`, or \`auto\`.`,
    ],
  });
}

/**
 * Checks a `row` value: a non-empty list of fields, cards, or tabs, never inside another row.
 */
function checkRow(row: unknown, inRow: boolean, ctx: LayoutContext): void {
  if (inRow) {
    ctx.problems.push({
      title: `A \`${ctx.option}\` row nests a row`,
      body: [`Rows${ctx.scope} do not nest.`, 'Put the inner fields directly in the outer row.'],
    });
  } else if (!isArray(row) || isEmpty(row)) {
    ctx.problems.push({
      title: `Invalid \`${ctx.option}\` row`,
      body: [`A row${ctx.scope} must be a non-empty array of fields, cards, or tabs.`],
    });
  } else {
    checkNodes(row, true, ctx);
  }
}

/**
 * Checks a `card` value: a non-empty node list, or an object with `fields`, `label`, and `collapsible`.
 */
function checkCard(card: unknown, ctx: LayoutContext): void {
  if (isArray(card)) {
    if (isEmpty(card)) invalidCard(ctx);
    else checkNodes(card, false, ctx);
    return;
  }
  if (!isPlainObject(card)) {
    invalidCard(ctx);
    return;
  }
  for (const key of Object.keys(card)) {
    if (CARD_KEYS.has(key)) continue;
    ctx.problems.push({
      title: `Unknown \`${ctx.option}\` card key \`${key}\``,
      body: ['The keys are `label`, `collapsible`, and `fields`.'],
    });
  }
  checkLabel(card.label, 'card', ctx);
  if (!isUndefined(card.collapsible) && !isBoolean(card.collapsible)) {
    ctx.problems.push({
      title: `Invalid \`${ctx.option}\` card \`collapsible\` flag`,
      body: [`\`collapsible\`${ctx.scope} must be a boolean.`],
    });
  }
  if (!isArray(card.fields) || isEmpty(card.fields)) invalidCard(ctx);
  else checkNodes(card.fields, false, ctx);
}

/**
 * Reports a `card` value of the wrong shape.
 */
function invalidCard(ctx: LayoutContext): void {
  ctx.problems.push({
    title: `Invalid \`${ctx.option}\` card`,
    body: [
      `A card${ctx.scope} is a non-empty array of nodes, or an object with a non-empty \`fields\` array.`,
    ],
  });
}

/**
 * Checks a `tabs` value: a non-empty list of `{ label, fields }` entries with non-empty fields.
 */
function checkTabs(tabs: unknown, ctx: LayoutContext): void {
  if (!isArray(tabs) || isEmpty(tabs)) {
    invalidTabs(ctx);
    return;
  }
  for (const tab of tabs) {
    if (!isPlainObject(tab)) {
      invalidTabs(ctx);
      continue;
    }
    for (const key of Object.keys(tab)) {
      if (TAB_KEYS.has(key)) continue;
      ctx.problems.push({
        title: `Unknown \`${ctx.option}\` tab key \`${key}\``,
        body: ['The keys are `label` and `fields`.'],
      });
    }
    if (isUndefined(tab.label)) {
      ctx.problems.push({
        title: `A \`${ctx.option}\` tab has no label`,
        body: [`Every tab${ctx.scope} needs a \`label\`.`],
      });
    } else {
      checkLabel(tab.label, 'tab', ctx);
    }
    if (!isArray(tab.fields) || isEmpty(tab.fields)) {
      ctx.problems.push({
        title: `A \`${ctx.option}\` tab has no fields`,
        body: [`Every tab${ctx.scope} needs a non-empty \`fields\` array.`],
      });
    } else {
      checkNodes(tab.fields, false, ctx);
    }
  }
}

/**
 * Reports a `tabs` value of the wrong shape.
 */
function invalidTabs(ctx: LayoutContext): void {
  ctx.problems.push({
    title: `Invalid \`${ctx.option}\` tabs`,
    body: [`\`tabs\`${ctx.scope} must be a non-empty array of \`{ label, fields }\` entries.`],
  });
}

/**
 * Checks an optional label against the host's label shape.
 */
function checkLabel(label: unknown, what: string, ctx: LayoutContext): void {
  if (isUndefined(label) || ctx.isLabel(label)) return;
  ctx.problems.push({
    title: `Invalid \`${ctx.option}\` ${what} label`,
    body: [
      `A ${what} label${ctx.scope} is a message key, a plain string, or a \`{ key, params }\` object.`,
    ],
  });
}
