import { defineHandler, notFound, queryUntyped } from 'ohnejs';

import { requireUser } from '../../../../auth/require-user.ts';
import { bookmarkCollection } from '../../../../bookmarks/bookmark-target.ts';

/**
 * `DELETE /dashboard/bookmarks/[collection]/[uuid]`
 *
 * Deletes the caller's own bookmark, answering `204`.
 * Every default view that named it goes with it.
 * Needs a signed-in user: no user `401`.
 * Read of the collection is not needed, so you can always withdraw what you saved.
 * An unknown collection, an unknown `UUID`, and someone else's bookmark are the same `404`.
 * So is a bookmark saved under another collection.
 */
export default defineHandler(async ({ params }): Promise<null> => {
  const user = await requireUser();
  const collection = bookmarkCollection(params.collection);
  const { deleted } = await queryUntyped('DashboardBookmarks')
    .where({ UUID: params.uuid, collection, user: user.UUID })
    .delete();
  if (deleted === 0) throw notFound();
  return null;
});
