import type { QueryRecord } from 'ohnejs';

import { badRequest } from 'ohnejs';
import { isBoolean, isString, isUndefined } from 'ohnejs/utils';

import type { User } from '../auth/types.ts';
import type { BookmarkEntry } from './types.ts';

/**
 * The bookmark fields a body may write, each optional.
 */
export type BookmarkChanges = Partial<Pick<BookmarkEntry, 'name' | 'view' | 'shared'>>;

/**
 * The `DashboardBookmarks` fields `bookmarkEntry` reads.
 */
export const BOOKMARK_FIELDS = ['UUID', 'name', 'view', 'shared', 'user'];

/**
 * A stored bookmark as the caller sees it, read with `BOOKMARK_FIELDS`.
 */
export function bookmarkEntry(record: QueryRecord, user: User): BookmarkEntry {
  return {
    UUID: record.UUID as string,
    name: record.name as string,
    view: record.view as string,
    shared: record.shared as boolean,
    mine: record.user === user.UUID,
  };
}

/**
 * The changes a JSON body asks for: `name` and `view` as text, `shared` as a boolean.
 * A value of the wrong JSON type is a `400`; any other key is ignored.
 */
export function bookmarkChanges(input: Record<string, unknown>): BookmarkChanges {
  const { name, view, shared } = input;
  const validName = isUndefined(name) || isString(name);
  const validView = isUndefined(view) || isString(view);
  const validShared = isUndefined(shared) || isBoolean(shared);
  if (!validName || !validView || !validShared) throw badRequest();
  return { name, view, shared };
}
