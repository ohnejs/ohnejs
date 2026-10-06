import type {
  AccessContext,
  CollectionName,
  CollectionOperation,
  UntypedQueryBuilder,
} from 'ohnejs';

import {
  applyScope,
  endpointOf,
  notFound,
  queryUntyped,
  resolveAccess,
  useCollections,
} from 'ohnejs';
import { isUndefined } from 'ohnejs/utils';

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
 * A read carries the whole scope; an update or delete only its `where`, and a create none.
 * No write narrows its input or its returned records to the scope's `select`.
 * The operation's named middleware do not run - a route of your own carries its own.
 * Valid only within a request.
 * A literal name must be a known collection; a name built at runtime is any `string`.
 *
 * @example
 * ```ts
 * export default defineHandler(async () => {
 *   const posts = await queryScoped('Posts', 'read')
 *   return posts.where({ status: 'published' }).findMany()
 * })
 * ```
 */
export async function queryScoped<C extends string>(
  collection: string extends C ? C : C extends CollectionName ? C : CollectionName,
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
  if (operation !== 'create' && !isUndefined(scope.where)) builder.access(scope.where);
  return builder;
}
