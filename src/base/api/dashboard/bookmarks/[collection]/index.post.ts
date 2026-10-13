import {
  badRequest,
  defineHandler,
  notFound,
  queryUntyped,
  readJSONBody,
  setResponseStatus,
} from 'ohnejs';
import { isPlainObject, isUndefined } from 'ohnejs/utils';

import type { BookmarkEntry } from '../../../../bookmarks/types.ts';

import { requireCapability } from '../../../../auth/capabilities.ts';
import { requireUser } from '../../../../auth/require-user.ts';
import { bookmarkChanges, bookmarkEntry } from '../../../../bookmarks/bookmark-entry.ts';
import { bookmarkCollection, bookmarkTarget } from '../../../../bookmarks/bookmark-target.ts';

/**
 * `POST /dashboard/bookmarks/[collection]`
 *
 * Saves a table bookmark of the collection from `{ name, view, shared? }` and answers `201` with it.
 * The caller owns it; a `user` in the body is ignored.
 * Needs a signed-in user who can read the collection: no user `401`.
 * An unknown collection, a singleton, and one the caller cannot read are the same `404`, before any `400`.
 * A body without a `name` or a `view`, or a value of the wrong JSON type, is a `400`.
 * Sharing needs `dashboard.bookmarks.share`, a `403` without it.
 * An empty or overlong name, or a view that is not a table's query string, is a `422`.
 */
export default defineHandler(async ({ params }): Promise<BookmarkEntry> => {
  const user = await requireUser();
  const collection = bookmarkCollection(params.collection);
  if (!(await bookmarkTarget(collection))) throw notFound();
  const body = await readJSONBody<unknown>();
  const { name, view, shared = false } = bookmarkChanges(isPlainObject(body) ? body : {});
  if (isUndefined(name) || isUndefined(view)) throw badRequest();
  if (shared) await requireCapability('dashboard.bookmarks.share');
  const record = await queryUntyped('DashboardBookmarks').createOrThrow({
    name,
    collection,
    view,
    user: user.UUID,
    shared,
  });
  setResponseStatus(201);
  return bookmarkEntry(record, user);
});
