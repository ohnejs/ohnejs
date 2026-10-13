import { notFound, useCollections } from 'ohnejs';
import { isUndefined } from 'ohnejs/utils';

import { collectionBySegment, readScope } from '../collections-api/gate.ts';

declare module 'ohnejs' {
  interface KnownCapabilities {
    /**
     * Sharing a dashboard table bookmark with everyone who can read its collection.
     * A shared bookmark publishes its filter values, so a role grants it apart.
     */
    'dashboard.bookmarks.share': true;
  }
}

/**
 * The registered name of the collection a bookmarks route's segment names.
 * An unknown segment is a `404`.
 */
export function bookmarkCollection(segment: string): string {
  const meta = collectionBySegment(segment);
  if (isUndefined(meta)) throw notFound();
  return meta.name;
}

/**
 * Whether the caller may list, save, or publish table bookmarks of the collection `name`.
 * It must be registered, not a singleton, and readable as `readScope` judges it.
 * Asking runs no read middleware; applying a view runs the real read, middleware included.
 */
export async function bookmarkTarget(name: string): Promise<boolean> {
  const meta = useCollections().get(name);
  if (isUndefined(meta) || meta.collection.singleton) return false;
  return (await readScope(name)) !== false;
}
