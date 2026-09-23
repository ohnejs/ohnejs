import type { QueryScope, Transaction, UntypedQueryBuilder } from 'ohnejs';

import {
  applyScope,
  endpointOf,
  notFound,
  queryUntyped,
  resolveAccess,
  useCollections,
} from 'ohnejs';
import { requireCapability, userCan, useUser } from 'ohnejs/auth';
import { chunk, isNull, isUndefined, pick } from 'ohnejs/utils';

import { uploadsError } from './_errors.ts';

/**
 * The part of an `Uploads` read `access` scope a write must keep its rows inside.
 */
export type UploadReach = Pick<QueryScope, 'where' | 'locale'>;

/**
 * The request's reach into `Uploads`, answering as the `Uploads` read does.
 * No user is a `401` and no capability a `403`, unless that read is public.
 * No exposed read, or a `false` scope, is a `404`.
 */
export async function uploadReach(): Promise<UploadReach> {
  const endpoint = endpointOf(useCollections().get('Uploads')?.collection.api, 'read');
  if (isUndefined(endpoint)) throw notFound();
  if (endpoint.public !== true) await requireCapability('collection.Uploads.read');
  const scope = await resolveAccess(endpoint, { operation: 'read' });
  if (scope === false) throw notFound();
  return pick(scope, ['where', 'locale']);
}

/**
 * The request's reach into `Uploads` as the collections API would grant it, without throwing.
 * It needs an exposed read with an `access` scope that is not `false`.
 * Unless that read is public, it also needs a user with `collection.Uploads.read`.
 * `undefined` otherwise.
 */
export async function readerReach(): Promise<UploadReach | undefined> {
  const endpoint = endpointOf(useCollections().get('Uploads')?.collection.api, 'read');
  if (isUndefined(endpoint)) return undefined;
  if (endpoint.public !== true && !(await canRead())) return undefined;
  const scope = await resolveAccess(endpoint, { operation: 'read' });
  return scope === false ? undefined : pick(scope, ['where', 'locale']);
}

/**
 * Whether the request's user holds `collection.Uploads.read` and `readerReach` admits the row `uuid`.
 * `false` outside a request, where no one is signed in.
 */
export async function readerReaches(uuid: string): Promise<boolean> {
  if (!(await canRead())) return false;
  const reach = await readerReach();
  return !isUndefined(reach) && reached(reach).where({ UUID: uuid }).exists();
}

/**
 * Refuses the row `uuid` with a `404` unless `reach` admits it.
 * On `tx` the check reads inside that transaction, atomic with the write it guards.
 */
export async function assertUploadReach(
  uuid: string,
  reach: UploadReach,
  tx?: Transaction,
): Promise<void> {
  if (!(await reached(reach, tx).where({ UUID: uuid }).exists())) throw notFound();
}

/**
 * The `UUID`s under the folder at `path` that `reach` admits, none when it has no `where`.
 */
export async function reachedSubtree(
  tx: Transaction,
  reach: UploadReach | undefined,
  path: string,
): Promise<string[]> {
  if (isUndefined(reach?.where)) return [];
  const subtree = reached(reach, tx).whereAny((g) => [
    g.where({ directory: path }),
    g.where({ directory: { startsWith: `${path}/` } }),
  ]);
  return (await subtree.pluck('UUID')) as string[];
}

/**
 * Refuses the write on `tx` with a `422` unless `reach` still admits every row in `uuids`.
 */
export async function assertReached(
  tx: Transaction,
  reach: UploadReach | undefined,
  uuids: readonly string[],
): Promise<void> {
  if (isUndefined(reach?.where)) return;
  for (const batch of chunk(uuids, 900)) {
    const count = await reached(reach, tx)
      .where({ UUID: { in: batch } })
      .count();
    if (count < batch.length) throw uploadsError('', 'outOfReach');
  }
}

/**
 * `Uploads` under `reach`, on `tx` when given.
 */
function reached(reach: UploadReach, tx?: Transaction): UntypedQueryBuilder {
  const uploads = applyScope(queryUntyped('Uploads'), reach);
  return isUndefined(tx) ? uploads : uploads.use(tx);
}

async function canRead(): Promise<boolean> {
  const user = await useUser();
  return !isNull(user) && userCan(user, 'collection.Uploads.read');
}
