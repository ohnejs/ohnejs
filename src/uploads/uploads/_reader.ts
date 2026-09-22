import { applyScope, endpointOf, queryUntyped, resolveAccess, useCollections } from 'ohnejs';
import { userCan, useUser } from 'ohnejs/auth';
import { isNull, isUndefined } from 'ohnejs/utils';

/**
 * Whether the request's user may read the `Uploads` row `uuid`, as the collections API would let them.
 * They need a session, `collection.Uploads.read`, an exposed read, and an `access` scope admitting the row.
 * `false` outside a request, where no one is signed in.
 */
export async function readerReaches(uuid: string): Promise<boolean> {
  const user = await useUser();
  if (isNull(user) || !userCan(user, 'collection.Uploads.read')) return false;
  const endpoint = endpointOf(useCollections().get('Uploads')?.collection.api, 'read');
  if (isUndefined(endpoint)) return false;
  const scope = await resolveAccess(endpoint, { operation: 'read' });
  if (scope === false) return false;
  return applyScope(queryUntyped('Uploads'), scope).where({ UUID: uuid }).exists();
}
