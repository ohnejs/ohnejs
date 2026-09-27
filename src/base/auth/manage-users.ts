import type { AccessContext, AccessScope, FieldErrors, Message } from 'ohnejs';

import { isArray, isEmpty, isNull, isString } from 'ohnejs/utils';

import { validationError } from '../../ohne/query/write/errors.ts';
import { ungrantableRoles } from './capabilities.ts';
import { useUser } from './use-user.ts';

/**
 * The `Users` access resolver for create, update, and delete: the grant rule.
 *
 * You can grant a role only when your own capabilities cover every capability it lists.
 * You can edit or delete a user only when you could grant every role they hold.
 * A written `roles` entry naming a role you cannot grant rejects `422` at its `roles[n]` path.
 * A user out of reach answers the identical `404` a missing one does.
 * An app that sets its own `Users` `api` passes `manageUsers` as each write's `access` to keep the rule.
 *
 * @example
 * ```ts
 * // collections/Users.ts
 * import { defineCollection } from 'ohnejs'
 * import { manageUsers, usersDefinition } from 'ohnejs/auth'
 *
 * export default defineCollection({
 *   ...usersDefinition,
 *   api: {
 *     read: {},
 *     create: { access: manageUsers },
 *     update: { access: manageUsers },
 *     delete: { access: manageUsers },
 *   },
 * })
 * ```
 */
export async function manageUsers(
  context: AccessContext<'create' | 'update' | 'delete'>,
): Promise<AccessScope<'roles'> | boolean> {
  const user = await useUser();
  if (isNull(user)) return false;
  const denied = ungrantableRoles(user);
  if (context.operation !== 'delete' && isArray(context.input.roles)) {
    const errors: FieldErrors = {};
    context.input.roles.forEach((role, n) => {
      if (isString(role) && denied.includes(role))
        errors[`roles[${n}]`] = roleNotGrantableMessage(role);
    });
    if (!isEmpty(errors)) throw validationError(errors);
  }
  if (context.operation === 'create' || denied.length === 0) return true;
  return { where: { roles: { not: { includesAny: denied } } } };
}

/**
 * The `roleNotGrantable` failure as its `{ key, params }` message object.
 * Once `KnownMessages` has keys, the object must name one of them.
 * In this repo's typecheck only test fixtures supply those keys, so the cast bridges it.
 */
function roleNotGrantableMessage(role: string): Message {
  return { key: 'auth.roleNotGrantable', params: { role } } as unknown as Message;
}
