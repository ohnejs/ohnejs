/**
 * One table bookmark as the bookmarks routes answer it.
 */
export interface BookmarkEntry {
  /**
   * The bookmark's `UUID`.
   */
  UUID: string;

  /**
   * The name it is listed under.
   */
  name: string;

  /**
   * The table's query string without the leading `?`; `''` is the declared view.
   */
  view: string;

  /**
   * Whether everyone who can read the collection lists it.
   */
  shared: boolean;

  /**
   * Whether the caller saved it, and so may change it.
   * It stands in for the owner, whose `UUID` never leaves the server.
   */
  mine: boolean;
}

/**
 * A collection's bookmarks, as `GET /dashboard/bookmarks/[collection]` answers them.
 */
export interface BookmarkList {
  /**
   * The caller's own and the shared bookmarks, sorted naturally by name.
   */
  bookmarks: BookmarkEntry[];

  /**
   * The `UUID` of the caller's default view among them, `null` when the table opens on the declared view.
   */
  default: string | null;
}

/**
 * A user's default view of one table, as `PUT /dashboard/bookmarks/[collection]/default` answers it.
 */
export interface BookmarkDefault {
  /**
   * The `UUID` of the bookmark the table opens on.
   */
  bookmark: string;

  /**
   * That bookmark's view.
   */
  view: string;
}
