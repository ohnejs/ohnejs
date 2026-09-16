import type { DashboardLayoutNode } from '../runtime/meta-types.ts';

import { last } from '../../utils/array/last.ts';
import { isEmpty } from '../../utils/is/is-empty.ts';

/**
 * A layout placed over the names a form renders.
 */
export interface PlacedLayout {
  /**
   * The layout's nodes, every unrendered name and every container it emptied dropped.
   */
  nodes: DashboardLayoutNode[];

  /**
   * The rendered names the layout does not place, in the order given.
   */
  rest: string[];
}

/**
 * Places a layout over the names a form renders.
 * A name the form does not render is dropped, and so is a row, card, or tab left empty with it.
 * A rule never leads, trails, or follows another rule.
 * The rendered names the layout does not place come back as `rest`, in the order given.
 *
 * @example
 * ```ts
 * placeLayout(
 *   [{ kind: 'field', name: 'a' }, { kind: 'field', name: 'gone' }],
 *   ['a', 'b'],
 * )
 * // -> { nodes: [{ kind: 'field', name: 'a' }], rest: ['b'] }
 * ```
 */
export function placeLayout(
  layout: readonly DashboardLayoutNode[],
  names: readonly string[],
): PlacedLayout {
  const rendered = new Set(names);
  const nodes = placeNodes(layout, rendered);
  const placed = new Set(layoutNodeNames(nodes));
  return { nodes, rest: names.filter((name) => !placed.has(name)) };
}

/**
 * The field names the nodes hold, in reading order: rows left to right, cards and tabs top to bottom.
 *
 * @example
 * ```ts
 * layoutNodeNames([
 *   { kind: 'row', nodes: [{ kind: 'field', name: 'a' }] },
 *   { kind: 'field', name: 'b' },
 * ])
 * // -> ['a', 'b']
 * ```
 */
export function layoutNodeNames(nodes: readonly DashboardLayoutNode[]): string[] {
  const names: string[] = [];
  for (const node of nodes) {
    if (node.kind === 'field') names.push(node.name);
    else if (node.kind === 'row' || node.kind === 'card')
      names.push(...layoutNodeNames(node.nodes));
    else if (node.kind === 'tabs') {
      for (const tab of node.tabs) names.push(...layoutNodeNames(tab.nodes));
    }
  }
  return names;
}

/**
 * Keeps the nodes over `rendered` names, dropping emptied containers and stray rules.
 */
function placeNodes(
  nodes: readonly DashboardLayoutNode[],
  rendered: ReadonlySet<string>,
): DashboardLayoutNode[] {
  const kept: DashboardLayoutNode[] = [];
  for (const node of nodes) {
    switch (node.kind) {
      case 'field':
        if (rendered.has(node.name)) kept.push(node);
        break;
      case 'row':
      case 'card': {
        const inner = placeNodes(node.nodes, rendered);
        if (!isEmpty(inner)) kept.push({ ...node, nodes: inner });
        break;
      }
      case 'tabs': {
        const tabs = node.tabs
          .map((tab) => ({ ...tab, nodes: placeNodes(tab.nodes, rendered) }))
          .filter((tab) => !isEmpty(tab.nodes));
        if (!isEmpty(tabs)) kept.push({ ...node, tabs });
        break;
      }
      case 'rule':
        if (!isEmpty(kept) && last(kept)?.kind !== 'rule') kept.push(node);
        break;
    }
  }
  if (last(kept)?.kind === 'rule') kept.pop();
  return kept;
}
