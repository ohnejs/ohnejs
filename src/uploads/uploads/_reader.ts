import { endpointOf, notFound, resolveAccess, useCollections } from 'ohnejs';
import { requireCapability, userCan, useUser } from 'ohnejs/auth';
import { isNull, isUndefined, pick } from 'ohnejs/utils';

import type { UploadReach } from './_reach.ts';

import { reached } from './_reach.ts';

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

async function canRead(): Promise<boolean> {
  const user = await useUser();
  return !isNull(user) && userCan(user, 'collection.Uploads.read');
}
