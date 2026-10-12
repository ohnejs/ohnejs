import type { IconName } from '../../utils/icon/icon-name.ts';
import type { LiteralUnion } from '../../utils/types/literal-union.ts';
import type { CollectionName } from '../collections/known-collections.ts';
import type { ConfigExtensions } from '../layers/config.ts';
import type { Message } from '../messages/known-messages.ts';
import type { Capability } from '../roles/known-capabilities.ts';

/**
 * The ids the stacked layers give their menu nodes, read from the generated config defaults.
 */
type LayerMenuID = ConfigExtensions extends { defaults: { dashboard: { menu: infer M } } }
  ? M extends Record<string, unknown>
    ? Extract<keyof M, string>
    : never
  : never;

/**
 * The id of a dashboard menu node: a collection name, a node a layer declares, or your own.
 */
export type DashboardMenuID = LiteralUnion<CollectionName | LayerMenuID>;

/**
 * One node of the dashboard sidebar, declared under its id in `dashboard.menu`.
 *
 * A node with a `to` is a link; one without is a group that holds the nodes naming it their `parent`.
 * A node keyed by a collection name places that collection's link, its label and icon the collection's own.
 * Every layer patches the nodes by id, so a closer layer can move, relabel, hide, or reveal any of them.
 * A field a closer layer omits keeps the value a deeper layer gave it.
 *
 * @example
 * ```ts
 * const menu: Record<string, DashboardMenuNode> = {
 *   shop: { order: 2, label: 'Shop' },
 *   sales: { parent: 'shop', to: '/sales', label: 'Sales', icon: 'coin', can: 'sales.read' },
 *   Orders: { parent: 'shop' },
 *   Users: { hidden: true },
 * }
 * ```
 */
export interface DashboardMenuNode {
  /**
   * The id of the group or link this node sits under.
   * `null` places it at the root, even over a parent a deeper layer set.
   * Omitted, a collection sits under `collections` and any other node at the root.
   */
  parent?: DashboardMenuID | null;

  /**
   * The node's position among its siblings, lowest first.
   * Siblings of equal order keep the order they were declared in, a deeper layer's first.
   * A collection no layer places follows them, sorted by name.
   *
   * @default
   * 10
   */
  order?: number;

  /**
   * The text the node shows.
   * Pass a message key to translate it per the viewer's language.
   * A `{ key, params }` object supplies a parameterized message; a plain string is shown as-is.
   * A link needs one unless it is a collection.
   * A group without one shows no heading at the root, and its id in sentence case below it.
   */
  label?: Message;

  /**
   * The Tabler icon shown before the label.
   * Omitted, a collection shows its own icon and any other node none.
   */
  icon?: IconName;

  /**
   * The dashboard path the node opens, such as `/reports`.
   * Omitted, the node is a group, dropped while none of its nodes shows.
   */
  to?: string;

  /**
   * The capability a viewer needs to see the node and every node under it.
   * The menu is never access control: the page it opens still guards itself.
   */
  can?: Capability;

  /**
   * Hides the node and every node under it.
   * A closer layer sets `false` to bring it back.
   *
   * @default
   * false
   */
  hidden?: boolean;
}
