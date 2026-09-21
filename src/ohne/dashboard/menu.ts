import type { IconName } from '../../utils/icon/icon-name.ts';
import type { CollectionName } from '../collections/known-collections.ts';
import type { Message } from '../messages/known-messages.ts';

/**
 * A link row in a dashboard menu group, pointing at any dashboard page.
 * The row always renders: the dashboard knows no capability for a page, so nothing filters it.
 * Scope one to a role from a `dashboard:menu` hook.
 */
export interface DashboardMenuLink {
  /**
   * The dashboard path the row opens, such as `/reports` or `/collections/pages`.
   * A route the dashboard router resolves; an unmatched path lands on the not-found page.
   */
  to: string;

  /**
   * The row's label, shown next to its icon.
   * Pass a message key to translate it per the viewer's language.
   * A `{ key, params }` object supplies a parameterized message; a plain string is shown as-is.
   */
  label: Message;

  /**
   * The Tabler icon shown before the label.
   * Omitted, the row renders no icon.
   */
  icon?: IconName;
}

/**
 * One row of a dashboard menu group.
 * A collection name renders that collection's list link, dropping when the viewer cannot reach it.
 * A singleton's row opens its record instead of a list.
 * A `DashboardMenuLink` renders a link to any dashboard page.
 *
 * @example
 * ```ts
 * const entries: DashboardMenuEntry[] = [
 *   'Pages',
 *   { to: '/reports', label: 'menu.reports', icon: 'chart-bar' },
 * ]
 * ```
 */
export type DashboardMenuEntry = CollectionName | DashboardMenuLink;
