import { defineCollection, field } from 'ohnejs';

/**
 * The `DashboardBookmarkDefaults` collection: the bookmark a user picked as their default view of a table.
 *
 * The bookmark may be another user's shared one.
 * The unique `user` and `collection` pair keeps one default per user and table.
 * `PUT /dashboard/bookmarks/[collection]/default` replaces the row.
 * Deleting the user or the bookmark deletes the row.
 * Never exposed over the API.
 */
export default defineCollection({
  fields: {
    user: field('record', {
      collection: 'Users',
      onDelete: 'cascade',
      label: 'dashboard.bookmarkDefaults.user.label',
      description: 'dashboard.bookmarkDefaults.user.description',
    }),

    collection: field('text', {
      label: 'dashboard.bookmarkDefaults.collection.label',
      description: 'dashboard.bookmarkDefaults.collection.description',
    }),

    bookmark: field('record', {
      collection: 'DashboardBookmarks',
      onDelete: 'cascade',
      label: 'dashboard.bookmarkDefaults.bookmark.label',
      description: 'dashboard.bookmarkDefaults.bookmark.description',
    }),
  },
  compositeIndexes: [{ fields: ['user', 'collection'], unique: true }],
});
