import { type Capability, forbidden, useRoles } from 'ohnejs';
import { hasCapability, uniqueArray } from 'ohnejs/utils';

import type { User } from './types.ts';

import { requireUser } from './require-user.ts';

/**
 * The capabilities a user holds: the union of every held role's capabilities, deduplicated.
 * An unknown role name grants nothing, so a role removed from code degrades and never breaks.
 * Pure registry work over the user's `roles`; no query runs.
 *
 * @example
 * ```ts
 * const user = await requireUser()
 * userCapabilities(user) // -> ['collection.Posts.*', 'billing.export']
 * ```
 */
export function userCapabilities(user: User): Capability[] {
  const roles = useRoles();
  return uniqueArray(user.roles.flatMap((name) => roles.get(name)?.role.capabilities ?? []));
}

/**
 * The registered roles the user cannot grant: those listing a capability the user's own do not cover.
 * Coverage follows `capabilityCovers`, pattern against pattern: `collection.*` covers `collection.Posts.*`.
 * `*` covers every role, so an admin gets `[]`; a role listing no capability is always grantable.
 *
 * @example
 * ```ts
 * const user = await requireUser()
 * ungrantableRoles(user) // -> ['admin']
 * ```
 */
export function ungrantableRoles(user: User): string[] {
  const held = userCapabilities(user);
  return Object.values(useRoles().all())
    .filter(({ role }) => !role.capabilities.every((capability) => hasCapability(held, capability)))
    .map(({ name }) => name);
}

/**
 * Whether the user holds `capability`, under the `capabilityCovers` wildcard rules.
 *
 * @example
 * ```ts
 * const user = await requireUser()
 * if (userCan(user, 'collection.Posts.update')) unlockEditor()
 * ```
 */
export function userCan(user: User, capability: Capability): boolean {
  return hasCapability(userCapabilities(user), capability);
}

/**
 * Returns the signed-in user when they hold `capability`.
 * No user is a `401`; a user without the capability is a `403`.
 * The guard a capability-protected route opens with.
 *
 * @example
 * ```ts
 * export default defineHandler(async () => {
 *   await requireCapability('collection.Posts.update')
 *   return publishDrafts()
 * })
 * ```
 */
export async function requireCapability(capability: Capability): Promise<User> {
  const user = await requireUser();
  if (!userCan(user, capability)) throw forbidden();
  return user;
}
