import { defineHandler, notFound, queryUntyped } from 'ohnejs';
import { naturalCompare } from 'ohnejs/utils';

import type { BookmarkList } from '../../../../bookmarks/types.ts';

import { requireUser } from '../../../../auth/require-user.ts';
import { BOOKMARK_FIELDS, bookmarkEntry } from '../../../../bookmarks/bookmark-entry.ts';
import { bookmarkCollection, bookmarkTarget } from '../../../../bookmarks/bookmark-target.ts';

/**
 * `GET /dashboard/bookmarks/[collection]`
 *
 * Lists the caller's own and the shared table bookmarks of a collection as `{ bookmarks, default }`.
 * The bookmarks sort naturally by name, and each says whether it is `mine` instead of naming its owner.
 * `default` is the `UUID` of the caller's default view among them, `null` when none of them is.
 * Needs a signed-in user who can read the collection: no user `401`.
 * An unknown collection, a singleton, and one the caller cannot read are the same `404`.
 */
export default defineHandler(async ({ params }): Promise<BookmarkList> => {
  const user = await requireUser();
  const collection = bookmarkCollection(params.collection);
  if (!(await bookmarkTarget(collection))) throw notFound();
  const rows = await queryUntyped('DashboardBookmarks')
    .where({ collection, or: [{ user: user.UUID }, { shared: true }] })
    .select(...BOOKMARK_FIELDS)
    .findMany();
  const bookmarks = rows
    .map((row) => bookmarkEntry(row, user))
    .sort((a, b) => naturalCompare(a.name, b.name));
  const chosen = await queryUntyped('DashboardBookmarkDefaults')
    .unscoped()
    .where({ user: user.UUID, collection })
    .pluck('bookmark');
  const listed = bookmarks.find((bookmark) => chosen.includes(bookmark.UUID));
  return { bookmarks, default: listed?.UUID ?? null };
});
