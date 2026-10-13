import { ohneError, useConfig } from 'ohnejs';
import { isUndefined } from 'ohnejs/utils';

const SIGN_IN = ['Users', 'Sessions'];

const BOOKMARKS = ['DashboardBookmarks', 'DashboardBookmarkDefaults'];

assertCollections();

/**
 * Refuses a `disable.collections` that drops a collection the layer ships, with an error block.
 * Every signed-in request reads the sign-in ones, and the bookmark routes read and write the others.
 * It runs as the file loads, since a sync without the collection drops its empty table.
 */
function assertCollections(): void {
  const disabled = useConfig().disable.collections;
  const name = [...SIGN_IN, ...BOOKMARKS].find((collection) => disabled.includes(collection));
  if (isUndefined(name)) return;
  const bookmarks = BOOKMARKS.includes(name);
  throw ohneError({
    title: `The \`ohnejs/base\` layer needs \`${name}\``,
    body: [
      bookmarks
        ? 'You list it in `disable.collections`, but the dashboard keeps its table bookmarks there.'
        : 'You list it in `disable.collections`, but sign-in keeps its users and sessions there.',
      '',
      `Remove \`${name}\` from \`disable.collections\`.`,
      ...(bookmarks
        ? ['To turn bookmarks off, list `/dashboard/bookmarks/**` in `disable.routes` instead.']
        : []),
    ],
  });
}
