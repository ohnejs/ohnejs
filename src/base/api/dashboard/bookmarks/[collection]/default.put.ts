import {
  badRequest,
  defineHandler,
  notFound,
  queryUntyped,
  readJSONBody,
  useDatabase,
} from 'ohnejs';
import { isNull, isString, isUndefined } from 'ohnejs/utils';

import type { User } from '../../../../auth/types.ts';
import type { BookmarkDefault } from '../../../../bookmarks/types.ts';

import { requireUser } from '../../../../auth/require-user.ts';
import { bookmarkCollection, bookmarkTarget } from '../../../../bookmarks/bookmark-target.ts';

/**
 * `PUT /dashboard/bookmarks/[collection]/default`
 *
 * Sets the caller's default view of the table from `{ bookmark }` and answers `{ bookmark, view }`.
 * The bookmark is the caller's own or a shared one; `null` clears the default and answers `204`.
 * Needs a signed-in user who can read the collection: no user `401`.
 * An unknown collection, a singleton, and one the caller cannot read are the same `404`, before any `400`.
 * A `bookmark` that is neither a string nor `null` is a `400`.
 * A bookmark of another collection, someone else's private one, and an unknown one are the same `404`.
 * One deleted before the default is written is a `422` at `bookmark`, and nothing changes.
 */
export default defineHandler(async ({ params }): Promise<BookmarkDefault | null> => {
  const user = await requireUser();
  const collection = bookmarkCollection(params.collection);
  if (!(await bookmarkTarget(collection))) throw notFound();
  const body = await readJSONBody<{ bookmark?: unknown } | null>();
  const bookmark = body?.bookmark;
  if (isNull(bookmark)) {
    await replaceDefault(user, collection, null);
    return null;
  }
  if (!isString(bookmark)) throw badRequest();
  const chosen = await queryUntyped('DashboardBookmarks')
    .where({ UUID: bookmark, collection, or: [{ user: user.UUID }, { shared: true }] })
    .select('view')
    .findFirst();
  if (isUndefined(chosen)) throw notFound();
  await replaceDefault(user, collection, bookmark);
  return { bookmark, view: chosen.view as string };
});

/**
 * Replaces the user's default row for `collection` with one naming `bookmark`, or with none for `null`.
 * The caller reads first, so the transaction holds the write lock for the two writes alone.
 */
async function replaceDefault(
  user: User,
  collection: string,
  bookmark: string | null,
): Promise<void> {
  await useDatabase().transaction(async (tx) => {
    const defaults = () => queryUntyped('DashboardBookmarkDefaults').use(tx).unscoped();
    await defaults().where({ user: user.UUID, collection }).delete();
    if (!isNull(bookmark))
      await defaults().createOrThrow({ user: user.UUID, collection, bookmark });
  }, 'immediate');
}
