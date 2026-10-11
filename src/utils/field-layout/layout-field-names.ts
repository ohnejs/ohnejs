import type { FieldLayout } from './field-layout.ts';

import { isString } from '../is/is-string.ts';
import { parseLayoutItem } from './parse-layout-item.ts';

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
export function layoutFieldNames(layout: FieldLayout<string, unknown>): string[] {
  const names: string[] = [];
  const walk = (nodes: FieldLayout<string, unknown>): void => {
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
