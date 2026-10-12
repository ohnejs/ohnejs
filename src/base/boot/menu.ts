import { hook, ohneError, useCollections, useConfig } from 'ohnejs';
import { didYouMean, isString, isUndefined } from 'ohnejs/utils';

// Once every collection is registered, so a parent the app lacks is known to be wrong.
hook('server:ready', assertMenu);

/**
 * Refuses a merged `dashboard.menu` whose nodes cannot form a tree, with an error block.
 *
 * - A `parent` names a declared node or a collection, disabled or not: a disabled one only drops its subtree.
 * - No node sits under itself, however far up the chain.
 * - A link that is not a collection carries a `label`, since nothing else names it.
 */
export function assertMenu(): void {
  const { dashboard, disable } = useConfig();
  const menu = dashboard?.menu ?? {};
  const collections = new Set([...useCollections().keys(), ...disable.collections]);
  const ids = new Set([...Object.keys(menu), ...collections]);
  for (const [id, node] of Object.entries(menu)) {
    if (isUndefined(node)) continue;
    const { parent } = node;
    if (isString(parent) && !ids.has(parent)) {
      const near = didYouMean(parent, ids);
      throw ohneError({
        title: `Menu node \`${id}\` sits under unknown node \`${parent}\``,
        body: [
          `No menu node or collection is named \`${parent}\`.`,
          ...(isUndefined(near) ? [] : ['', `Did you mean \`${near}\`?`]),
        ],
      });
    }
    if (!isUndefined(node.to) && isUndefined(node.label) && !collections.has(id)) {
      throw ohneError({
        title: `Menu link \`${id}\` has no label`,
        body: [
          `It opens \`${node.to}\`, but nothing names it in the sidebar.`,
          'Give it a `label`.',
        ],
      });
    }
    const chain = [id];
    for (let up = parent; isString(up); up = menu[up]?.parent) {
      const looped = chain.includes(up);
      chain.push(up);
      if (!looped) continue;
      if (up !== id) break;
      throw ohneError({
        title: `Menu node \`${id}\` sits under itself`,
        body: [
          `Its parents loop back to it: ${chain.map((link) => `\`${link}\``).join(' -> ')}.`,
          'Point one `parent` elsewhere, or set it to `null`.',
        ],
      });
    }
  }
}
