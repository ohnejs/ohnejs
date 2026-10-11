import type { MessageData } from '../i18n/message-data.ts';
import type { FieldLayout } from './field-layout.ts';

import { isEmpty } from '../is/is-empty.ts';
import { isString } from '../is/is-string.ts';
import { isUndefined } from '../is/is-undefined.ts';
import { parseLayoutItem } from './parse-layout-item.ts';

/**
 * A field the resolved layout places, by name.
 */
export interface ResolvedLayoutField {
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
export interface ResolvedLayoutRow<TLabel = MessageData> {
  /**
   * The node kind.
   */
  kind: 'row';

  /**
   * The entries, left to right; never empty.
   */
  nodes: ResolvedLayoutNode<TLabel>[];
}

/**
 * A bordered group of nodes.
 */
export interface ResolvedLayoutCard<TLabel = MessageData> {
  /**
   * The node kind.
   */
  kind: 'card';

  /**
   * The header label as declared; absent when the card declares none.
   */
  label?: TLabel;

  /**
   * Whether the viewer can collapse the card.
   */
  collapsible: boolean;

  /**
   * The nodes, top to bottom; never empty.
   */
  nodes: ResolvedLayoutNode<TLabel>[];
}

/**
 * A set of tabs, one panel of nodes per tab.
 */
export interface ResolvedLayoutTabs<TLabel = MessageData> {
  /**
   * The node kind.
   */
  kind: 'tabs';

  /**
   * The tabs, left to right; never empty.
   */
  tabs: ResolvedLayoutTab<TLabel>[];
}

/**
 * One tab of a `ResolvedLayoutTabs` node.
 */
export interface ResolvedLayoutTab<TLabel = MessageData> {
  /**
   * The tab label as declared.
   */
  label: TLabel;

  /**
   * The panel's nodes, top to bottom; never empty.
   */
  nodes: ResolvedLayoutNode<TLabel>[];
}

/**
 * A horizontal rule between stacked nodes.
 */
export interface ResolvedLayoutRule {
  /**
   * The node kind.
   */
  kind: 'rule';
}

/**
 * One node of a resolved field layout, as a form renders it.
 * Every node carries its `kind` and widths are split from their names, so a renderer parses nothing.
 * A name the host does not describe is already dropped, and so is any container left empty.
 */
export type ResolvedLayoutNode<TLabel = MessageData> =
  | ResolvedLayoutField
  | ResolvedLayoutRow<TLabel>
  | ResolvedLayoutCard<TLabel>
  | ResolvedLayoutTabs<TLabel>
  | ResolvedLayoutRule;

/**
 * Resolves a declared layout into render-ready nodes: widths split, names outside `names` dropped.
 * Labels pass through as declared.
 * A row, card, or tab left empty drops with them, so the result may be `[]`.
 *
 * @example
 * ```ts
 * resolveLayoutNodes([{ row: ['title | 60%', 'gone'] }, '---'], new Set(['title']))
 * // -> [{ kind: 'row', nodes: [{ kind: 'field', name: 'title', width: '60%' }] }, { kind: 'rule' }]
 *
 * resolveLayoutNodes([{ card: { label: 'Meta', fields: ['gone'] } }], new Set(['title']))
 * // -> []
 * ```
 */
export function resolveLayoutNodes<TLabel>(
  nodes: FieldLayout<string, TLabel>,
  names: ReadonlySet<string>,
): ResolvedLayoutNode<TLabel>[] {
  const resolved: ResolvedLayoutNode<TLabel>[] = [];
  for (const node of nodes) {
    if (node === '---') {
      resolved.push({ kind: 'rule' });
    } else if (isString(node)) {
      const { name, width } = parseLayoutItem(node);
      if (!names.has(name)) continue;
      const field: ResolvedLayoutField = { kind: 'field', name };
      if (!isUndefined(width)) field.width = width;
      resolved.push(field);
    } else if ('row' in node) {
      const inner = resolveLayoutNodes(node.row, names);
      if (!isEmpty(inner)) resolved.push({ kind: 'row', nodes: inner });
    } else if ('card' in node) {
      const options = 'fields' in node.card ? node.card : { fields: node.card };
      const inner = resolveLayoutNodes(options.fields, names);
      if (isEmpty(inner)) continue;
      const card: ResolvedLayoutCard<TLabel> = {
        kind: 'card',
        collapsible: options.collapsible ?? false,
        nodes: inner,
      };
      if (!isUndefined(options.label)) card.label = options.label;
      resolved.push(card);
    } else {
      const tabs = node.tabs
        .map((tab) => ({
          label: tab.label,
          nodes: resolveLayoutNodes(tab.fields, names),
        }))
        .filter((tab) => !isEmpty(tab.nodes));
      if (!isEmpty(tabs)) resolved.push({ kind: 'tabs', tabs });
    }
  }
  return resolved;
}
