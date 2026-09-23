import type { Transaction } from 'ohnejs';

import {
  applyScope,
  endpointOf,
  notFound,
  queryUntyped,
  resolveAccess,
  useCollections,
} from 'ohnejs';
import { queryScoped, userCan, useUser } from 'ohnejs/auth';
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

/**
 * Refuses the row `uuid` unless the request's user may read it, answering as the `Uploads` read does.
 * No user is a `401` and no capability a `403`, unless that read is public.
 * An unknown `UUID`, or one the read `access` scope hides, is a `404`.
 * So is every row while `Uploads` exposes no read.
 * On `tx` the check reads inside that transaction, atomic with the write it guards.
 */
export async function assertUploadReach(uuid: string, tx?: Transaction): Promise<void> {
  const uploads = await queryScoped('Uploads', 'read');
  if (!isUndefined(tx)) uploads.use(tx);
  if (!(await uploads.where({ UUID: uuid }).exists())) throw notFound();
}
