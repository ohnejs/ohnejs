# Table bookmarks

A bookmark saves a collection table's view under a name: its sort order, its filter, and its
columns. Apply one to get the same table back in a click, share it with your team, or make it the
view the table opens on.

The bookmark button sits in the table's footer, before Filter. It lists the bookmarks of that
collection:

- **Default settings** - the table as its collection declares it.
- **My bookmarks** - the ones you saved. "+ Bookmark" saves the current view under a new name.
- **Shared bookmarks** - the ones other users shared.

Bookmarks need nothing in your code. Anyone signed in who can read a collection, as its
[guard and `access`](../api/collections.md#exposure) decide, can save and apply its bookmarks. A
[singleton](../database/collections.md#singletons) has no table, so it has none.

## Saving a view

"+ Bookmark" asks for a name and saves the view you are looking at. The check button applies a
bookmark, and every bookmark that matches the current view is marked applied.

- A view keeps only what you changed. Columns and a sort left as declared follow your code when it
  changes later.
- The page number, an open record, and any other query parameters are not part of a view. Applying
  one starts on the first page.
- Your own bookmarks have a menu to update one to the current view, share it, rename it, or delete
  it.

## Your default view

The star makes a bookmark your default for that table. The table then opens on it whenever its URL
has no query, like a link from the sidebar. The star on Default settings goes back to the declared
view.

- Within a tab, the table reopens on the view you left it on. A new tab opens on your default. A
  reload keeps the view in the URL.
- Setting a default does not change the view you are looking at.
- A record picker for the collection follows the same rule: the view you last used in this tab,
  else your default.
- A default follows its bookmark: deleting the bookmark removes it, and unsharing hides it from
  everyone else until the bookmark is shared again.

## Sharing

Share lists a bookmark for every user who can read the collection. They can apply it and make it
their default, but only you can change it. Sharing needs the `dashboard.bookmarks.share`
[capability](../auth/roles.md#custom-capabilities):

```ts
// roles/editor.ts
import { defineRole } from 'ohnejs';

export default defineRole({
  capabilities: ['collection.Posts.*', 'dashboard.bookmarks.share'],
});
```

- A role granted `*` holds it. Without it, the menu offers no Share.
- Changing the name or the view of a shared bookmark needs it too. Stop sharing and Delete never do,
  so a user who loses it can still withdraw what they shared.

A shared bookmark tells its readers more than the records they can see:

- **It publishes its filter values.** Every reader of the collection sees them, even one whose
  [`access`](../api/collections.md#access) hides the filtered field. Keep private values out of a
  shared filter.
- **A read middleware does not hide it.** The list asks the collection's read guard and `access`,
  but never runs the read's [middleware](../api/collections.md#exposure). A middleware that refuses
  a reader leaves the shared bookmarks listed for them. Applying one runs the real read, so the
  records stay hidden.

## When a view stops working

A view can outlive what it names: a field is removed, or your access no longer reaches it. When the
server refuses part of a view, the table drops that part - the filter, the sort order, or the
columns - shows the rest, and says so in a toast. The bookmark itself never changes.

- This holds for every table URL, a hand-edited one too.
- A default with a refused part drops it again on each fresh load, with the toast each time. Update
  the bookmark, or choose another default, to stop it.

## The routes

The dashboard talks to these routes. `[collection]` is the collection's kebab-case name, as in the
[collections API](../api/collections.md#the-routes):

```
GET    /dashboard/bookmarks/[collection]           your own and the shared bookmarks, your default
POST   /dashboard/bookmarks/[collection]           { "name": "By title", "view": "order=[title]" }
PATCH  /dashboard/bookmarks/[collection]/[uuid]    change name, view, or shared
DELETE /dashboard/bookmarks/[collection]/[uuid]    delete one of your own
PUT    /dashboard/bookmarks/[collection]/default   { "bookmark": "<uuid>" }, or { "bookmark": null } to clear
```

A view is the table's query string without the leading `?`. `''` is the declared view.

## Turning bookmarks off

[Drop their routes](../project/config.md#disabling) to turn bookmarks off for everyone:

```ts
// ohne.config.ts
import { defineConfig } from 'ohnejs';

export default defineConfig({
  layers: ['ohnejs/base'],
  disable: { routes: ['/dashboard/bookmarks/**'] },
});
```

The tables then hide the bookmark button, and nobody has a default.

- Dropping one route hides only the controls that call it. Without
  `'PUT /dashboard/bookmarks/[collection]/default'`, the stars are gone and nobody has a default.
- The bookmarks live in the `DashboardBookmarks` and `DashboardBookmarkDefaults` collections. The
  layer needs both, so disabling one stops the boot.
