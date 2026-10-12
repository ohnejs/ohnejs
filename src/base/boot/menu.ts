import { hook, ohneError, useCollections, useConfig } from 'ohnejs';
import { didYouMean, isString, isUndefined } from 'ohnejs/utils';

// Once every collection is registered, so a parent the app lacks is known to be wrong.
hook('server:ready', assertMenu);

/**
 * Refuses a merged `dashboard.menu` whose nodes cannot form a tree, with an error block.
 *
 * - A `parent` names a declared node or a collection, disabled or not: a disabled one only drops its subtree.
 * - No node sits under itself, however far up the chain.
 * - A collection that names no `parent` sits under `collections`, as the sidebar places it.
 * - A link that is not a collection carries a `label`, since nothing else names it.
 * - A node that is no collection, opens no page, has no label, and holds nothing is a misspelled id.
 */
export function assertMenu(): void {
  const { dashboard, disable } = useConfig();
  const menu = dashboard?.menu ?? {};
  const collections = new Set([...useCollections().keys(), ...disable.collections]);
  const ids = new Set([...Object.keys(menu), ...collections]);
  const parentOf = (id: string): string | null | undefined => {
    const declared = menu[id]?.parent;
    if (!isUndefined(declared)) return declared;
    return collections.has(id) && !isUndefined(menu.collections) ? 'collections' : undefined;
  };
  const holders = new Set([...ids].map(parentOf));
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
    for (let up = parentOf(id); isString(up); up = parentOf(up)) {
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
  for (const [id, node] of Object.entries(menu)) {
    if (isUndefined(node)) continue;
    if (
      !collections.has(id) &&
      isUndefined(node.to) &&
      isUndefined(node.label) &&
      !holders.has(id)
    ) {
      const near = didYouMean(
        id,
        [...ids].filter((other) => other !== id),
      );
      throw ohneError({
        title: `Menu node \`${id}\` holds nothing`,
        body: [
          'It is no collection, opens no page, and no node sits under it.',
          ...(isUndefined(near)
            ? ['Give it a `to`, or drop it.']
            : ['', `Did you mean \`${near}\`?`]),
        ],
      });
    }
  }
}
