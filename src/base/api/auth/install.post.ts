import {
  defineHandler,
  forbidden,
  queryMetadata,
  queryUntyped,
  readJSONBody,
  useDatabase,
} from 'ohnejs';
import { hasKey, pick } from 'ohnejs/utils';

import type { User } from '../../auth/types.ts';

import { translate } from '../../../ohne/http/translate.ts';
import { commitEffects } from '../../../ohne/query/write/committed.ts';
import { createSession } from '../../auth/create-session.ts';
import { toUser } from '../../auth/to-user.ts';

/**
 * `POST /auth/install`
 *
 * Creates the first user from `{ email, password }` with the `admin` role, then signs it in.
 * A `firstName` and `lastName` ride along when given and `Users` declares them.
 * Refuses with `403` once any user exists, so the route disarms itself after the setup.
 * The check reads past any app scope, so a hidden user still disarms it.
 * The field pipeline validates the input; a failure answers `422` with per-field messages.
 * Success opens a persistent session, sets the cookie, and answers the `User` like login.
 */
export default defineHandler(async (): Promise<User> => {
  const body = (await readJSONBody<Record<string, unknown> | null>()) ?? {};
  const { fields } = queryMetadata('Users');
  const names = ['firstName', 'lastName'].filter((name) => hasKey(fields, name));
  const record = await useDatabase().transaction(async (tx) => {
    if (await queryUntyped('Users').unscoped().exists())
      throw forbidden(translate('auth.alreadyInstalled'));
    return queryUntyped('Users')
      .use(tx)
      .createOrThrow({
        ...pick(body, names),
        email: body.email,
        password: body.password,
        roles: ['admin'],
      });
  }, 'immediate');
  await commitEffects({ collection: 'Users', operation: 'create', uuids: [record.UUID as string] });

  await createSession(record.UUID as string);
  return toUser(record);
});
