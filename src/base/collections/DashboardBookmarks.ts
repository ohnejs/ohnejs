import { defineCollection, field } from 'ohnejs';
import { isArray, isString, parseCondition, parseSearchParams } from 'ohnejs/utils';

const VIEW_KEYS = new Set(['order', 'where', 'columns']);

/**
 * The `DashboardBookmarks` collection: one named table view per row, saved by a dashboard user.
 *
 * `collection` names the collection whose table the view belongs to.
 * `view` is that table's query string without the leading `?`, holding only `order`, `where` and `columns`.
 * A part the view omits follows the table's declared defaults, so it keeps up with later code changes.
 * A save checks only the view's shape; the table drops a part the query refuses when it applies the view.
 * `shared` lists the bookmark for everyone who can read the collection, filter values included.
 * The routes under `/dashboard/bookmarks/[collection]` set `user` to the caller and keep every write theirs.
 * Deleting a user deletes their bookmarks.
 * Never exposed over the API.
 */
export default defineCollection({
  fields: {
    name: field('text', {
      max: 120,
      label: 'dashboard.bookmarks.name.label',
      description: 'dashboard.bookmarks.name.description',
    }),

    collection: field('text', {
      immutable: true,
      label: 'dashboard.bookmarks.collection.label',
      description: 'dashboard.bookmarks.collection.description',
    }),

    view: field('text', {
      allowEmpty: true,
      max: 4096,
      validators: [viewProblem],
      label: 'dashboard.bookmarks.view.label',
      description: 'dashboard.bookmarks.view.description',
    }),

    user: field('record', {
      collection: 'Users',
      onDelete: 'cascade',
      immutable: true,
      label: 'dashboard.bookmarks.user.label',
      description: 'dashboard.bookmarks.user.description',
    }),

    shared: field('boolean', {
      default: false,
      label: 'dashboard.bookmarks.shared.label',
      description: 'dashboard.bookmarks.shared.description',
    }),
  },
  compositeIndexes: [{ fields: ['collection', 'user'] }],
});

/**
 * Rejects a view that is not a table query string: a leading `?` or `#`, an unknown key, or a non-text list.
 * A `where` must parse as a condition object.
 * Whether its fields exist and the reader may filter by them is the query's call when the view applies.
 */
function viewProblem(view: string): 'validation.invalidValue' | undefined {
  const valid =
    !/^[?#]/.test(view) &&
    Object.entries(parseSearchParams(view)).every(([key, value]) =>
      key === 'where' ? parseCondition(value).ok : VIEW_KEYS.has(key) && isTextList(value),
    );
  return valid ? undefined : 'validation.invalidValue';
}

/**
 * Whether a parsed param is a string or a list of strings.
 */
function isTextList(value: unknown): boolean {
  return isString(value) || (isArray(value) && value.every(isString));
}
