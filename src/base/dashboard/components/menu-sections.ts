import type { DashboardMenuItem, MessageData } from 'ohnejs/dashboard';

import { isUndefined } from 'ohnejs/utils';

/**
 * One titled run of sidebar nodes, drawn as one `verticalMenu`.
 */
export interface MenuSection {
  /**
   * The id of the root node the section starts at, unique across the menu.
   */
  key: string;

  /**
   * The section heading, a message; `''` draws the section without one.
   */
  label: MessageData;

  /**
   * The nodes the section lists, in order.
   */
  items: DashboardMenuItem[];
}

/**
 * Splits the menu's root nodes into sidebar sections.
 * A root group is a section under its label, listing its children.
 * Adjacent root links share one untitled section.
 */
export function menuSections(menu: readonly DashboardMenuItem[]): MenuSection[] {
  const sections: MenuSection[] = [];
  let links: MenuSection | undefined;
  for (const node of menu) {
    if (isUndefined(node.to)) {
      links = undefined;
      sections.push({ key: node.id, label: node.label, items: node.children ?? [] });
    } else if (isUndefined(links)) {
      links = { key: node.id, label: '', items: [node] };
      sections.push(links);
    } else {
      links.items.push(node);
    }
  }
  return sections;
}
