import { badRequest, defineHandler, notFound, queryUntyped, readJSONBody } from 'ohnejs';
import { isPlainObject, isUndefined } from 'ohnejs/utils';

import type { BookmarkEntry } from '../../../../bookmarks/types.ts';

import { requireCapability } from '../../../../auth/capabilities.ts';
import { requireUser } from '../../../../auth/require-user.ts';
import { bookmarkChanges, bookmarkEntry } from '../../../../bookmarks/bookmark-entry.ts';
import { bookmarkCollection, bookmarkTarget } from '../../../../bookmarks/bookmark-target.ts';

/**
 * `PATCH /dashboard/bookmarks/[collection]/[uuid]`
 *
 * Changes the caller's own bookmark from any of `{ name, view, shared }` and answers it.
 * Needs a signed-in user: no user `401`.
 * An unknown collection, an unknown `UUID`, and someone else's bookmark are the same `404`.
 * So is a bookmark saved under another collection.
 * Changing `name` or `view`, or sharing, also needs read of the collection, the same `404` without it.
 * Every `404` comes before any `400`.
 * A body naming nothing, or a value of the wrong JSON type, is a `400`.
 * A write that leaves it shared and sets `name`, `view`, or `shared: true` needs `dashboard.bookmarks.share`.
 * Without it the write is a `403`; unsharing never needs it.
 * An empty or overlong name, or a view that is not a table's query string, is a `422`.
 */
export default defineHandler(async ({ params }): Promise<BookmarkEntry> => {
  const user = await requireUser();
  const collection = bookmarkCollection(params.collection);
  const own = { UUID: params.uuid, collection, user: user.UUID };
  const row = await queryUntyped('DashboardBookmarks').where(own).select('shared').findFirst();
  if (isUndefined(row)) throw notFound();
  const body = await readJSONBody<unknown>();
  const input = isPlainObject(body) ? body : {};
  const edits = !isUndefined(input.name) || !isUndefined(input.view) || input.shared === true;
  if (edits && !(await bookmarkTarget(collection))) throw notFound();
  const changes = bookmarkChanges(input);
  if (Object.values(changes).every(isUndefined)) throw badRequest();
  if (edits && (changes.shared ?? row.shared) === true) {
    await requireCapability('dashboard.bookmarks.share');
  }
  const [record] = await queryUntyped('DashboardBookmarks').where(own).updateOrThrow(changes);
  if (isUndefined(record)) throw notFound();
  return bookmarkEntry(record, user);
});
