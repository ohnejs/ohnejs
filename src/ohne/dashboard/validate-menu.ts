import {
  didYouMean,
  isBoolean,
  isLocalPath,
  isMessage,
  isNull,
  isPlainObject,
  isRealNumber,
  isString,
  isUndefined,
} from '../../utils/index.ts';
import { ohneError } from '../error/ohne-error.ts';
import { validateIcon } from './validate-icon.ts';

const NODE_KEYS = ['parent', 'order', 'label', 'icon', 'to', 'can', 'hidden'];

/**
 * Rejects a `dashboard.menu` whose nodes the sidebar cannot use, the error landing on `file`.
 * It runs per layer, on the file that declares the menu, so a bad node never hides in the merge.
 *
 * - Each node is an object holding only `DashboardMenuNode` keys.
 * - `parent` is an id or `null`, `order` a finite number, `can` a capability, `hidden` a boolean.
 * - `label` is a message, and `icon` an icon the set carries.
 * - `to` is a path on the dashboard's own origin, so a layer's link never leaves it.
 *
 * Where each node sits is checked once every layer has merged, as the server starts.
 */
export function validateMenu(menu: unknown, file: string): void {
  if (isUndefined(menu)) return;
  if (!isPlainObject(menu)) {
    throw ohneError({
      title: 'Invalid `dashboard.menu`',
      body: [
        '`dashboard.menu` maps each node id to its node, like `{ reports: { to: "/reports" } }`.',
      ],
      path: file,
    });
  }
  for (const [id, node] of Object.entries(menu)) {
    if (isUndefined(node)) continue;
    const problem = nodeProblem(node);
    if (!isUndefined(problem)) {
      throw ohneError({ title: `Invalid menu node \`${id}\``, body: problem, path: file });
    }
    validateIcon((node as { icon?: unknown }).icon, 'icon', ` of menu node \`${id}\``, file);
  }
}

/**
 * What makes one declared menu node unusable, as error body rows, or `undefined` when its shape holds.
 */
function nodeProblem(node: unknown): string[] | undefined {
  if (!isPlainObject(node)) return ['A menu node is an object, like `{ parent: "general" }`.'];
  const unknown = Object.keys(node).find((key) => !NODE_KEYS.includes(key));
  if (!isUndefined(unknown)) {
    const near = didYouMean(unknown, NODE_KEYS);
    const row = `\`${unknown}\` is not a menu node key.`;
    return isUndefined(near) ? [row] : [row, '', `Did you mean \`${near}\`?`];
  }
  const { parent, order, label, to, can, hidden } = node;
  if (!isUndefined(parent) && !isNull(parent) && !isString(parent)) {
    return ['`parent` is the id of another node, or `null` for the root.'];
  }
  if (!isUndefined(order) && !isRealNumber(order)) return ['`order` is a finite number.'];
  if (!isUndefined(label) && !isMessage(label)) {
    return ['`label` is a message: a string, or a `{ key, params }` object.'];
  }
  if (!isUndefined(to) && !(isString(to) && isLocalPath(to))) {
    return ['`to` is a dashboard path that starts with `/`, like `/reports`.'];
  }
  if (!isUndefined(can) && !isString(can)) return ['`can` is a capability, like `reports.read`.'];
  if (!isUndefined(hidden) && !isBoolean(hidden)) return ['`hidden` is `true` or `false`.'];
  return undefined;
}
