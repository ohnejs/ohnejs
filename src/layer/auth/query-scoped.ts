import type { AccessContext, CollectionName, CollectionOperation, UntypedQueryBuilder } from 'ohne';

import {
  applyScope,
  endpointOf,
  notFound,
  queryUntyped,
  resolveAccess,
  useCollections,
} from 'ohne';
import { isUndefined } from 'ohne/utils';

import { requireCapability } from './capabilities.ts';

/**
 * Opens a query under one operation's policy, as the collections API runs it for the caller.
 *
 * The collection's `api` exposure decides first: a closed operation is a `404`.
 * Unless the operation is `public`, the caller needs the `collection.<Name>.<operation>` capability.
 * No user is a `401`, a user without it a `403`.
 * The operation's `access` resolver then runs; `false` is the identical `404`.
 * A create or update hands the resolver `input`, the write the caller intends.
 * Omitted, the resolver judges an empty write.
 * A read composes the whole scope onto the returned builder.
 * An update or delete ANDs the scope's `where` in, as the shipped handlers do; a create stays bare.
 * The operation's named middleware do not run - a route of your own carries its own.
 * Valid only within a request.
 *
 * @example
 * ```ts
 * export default defineHandler(async () => {
 *   const posts = await queryScoped('Posts', 'read')
 *   return posts.where({ status: 'published' }).findMany()
 * })
 * ```
 */
export async function queryScoped(
  collection: CollectionName,
  operation: CollectionOperation,
  input: Record<string, unknown> = {},
): Promise<UntypedQueryBuilder> {
  const endpoint = endpointOf(useCollections().get(collection)?.collection.api, operation);
  if (isUndefined(endpoint)) throw notFound();
  if (endpoint.public !== true) await requireCapability(`collection.${collection}.${operation}`);
  const context = (
    operation === 'create' || operation === 'update' ? { operation, input } : { operation }
  ) as AccessContext;
  const scope = await resolveAccess(endpoint, context);
  if (scope === false) throw notFound();
  const builder = queryUntyped(collection);
  if (operation === 'read') return applyScope(builder, scope);
  if (operation !== 'create' && !isUndefined(scope.where)) builder.where(scope.where);
  return builder;
}
