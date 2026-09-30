import type { AccessContext, AccessScope } from 'ohnejs';

import { defineCollection, field } from 'ohnejs';
import { manageUsers, usersDefinition } from 'ohnejs/auth';
import { isNull, isUndefined } from 'ohnejs/utils';

import { validationError } from '../../ohne/query/write/errors.ts';

/**
 * The `Users` create and update access of the assistant layer: `manageUsers`, with `autoAccept` guarded.
 * A body that would turn `autoAccept` on answers `422` at its path, so nobody sets it for someone else.
 * The person turns it on through `PATCH /auth/me`, which the assistant never reaches.
 * An app that sets its own `Users` `api` passes it as each create's and update's `access` to keep the rule.
 *
 * @example
 * ```ts
 * // collections/Users.ts
 * import { defineCollection } from 'ohnejs'
 * import { aiUsersDefinition, manageAIUsers } from 'ohnejs/ai'
 * import { manageUsers } from 'ohnejs/auth'
 *
 * export default defineCollection({
 *   ...aiUsersDefinition,
 *   api: {
 *     read: {},
 *     create: { access: manageAIUsers },
 *     update: { access: manageAIUsers },
 *     delete: { access: manageUsers },
 *   },
 * })
 * ```
 */
export function manageAIUsers(
  context: AccessContext<'create' | 'update'>,
): Promise<AccessScope<'roles'> | boolean> {
  const { autoAccept } = context.input;
  if (!isUndefined(autoAccept) && !isNull(autoAccept) && autoAccept !== false) {
    throw validationError({ autoAccept: 'ai.users.autoAccept.ownOnly' });
  }
  return manageUsers(context);
}

/**
 * The `Users` collection with the assistant's account setting `autoAccept`, off until the person turns it on.
 * With it on, the writes `ai.autoAccept` covers run without asking.
 * It is nullable, so an existing table gains it without a migration, and `null` reads as off.
 */
const users = defineCollection({
  ...usersDefinition,
  api: {
    read: {},
    create: { access: manageAIUsers },
    update: { access: manageAIUsers },
    delete: { access: manageUsers },
  },
  fields: {
    ...usersDefinition.fields,
    autoAccept: field('boolean', {
      nullable: true,
      default: false,
      display: 'buttons',
      trueLabel: 'ai.users.autoAccept.enabled',
      falseLabel: 'ai.users.autoAccept.disabled',
      label: 'ai.users.autoAccept.label',
      description: 'ai.users.autoAccept.description',
    }),
  },
});

/**
 * The assistant's `Users` definition, for an app's own `collections/Users.ts` to spread and extend.
 * Spread it in place of `usersDefinition`, since the registered `Users` must carry `autoAccept`.
 * Spreading it keeps the grant rule and the guard on `autoAccept`.
 * An override setting its own `api` drops both unless each create and update passes `access: manageAIUsers`.
 *
 * @example
 * ```ts
 * // collections/Users.ts
 * import { defineCollection, field } from 'ohnejs'
 * import { aiUsersDefinition } from 'ohnejs/ai'
 *
 * export default defineCollection({
 *   ...aiUsersDefinition,
 *   fields: {
 *     ...aiUsersDefinition.fields,
 *     phone: field('text', { nullable: true }),
 *   },
 * })
 * ```
 */
export const aiUsersDefinition: typeof users = users;

export default users;
