import { badRequest, defineHandler, notFound, queryUntyped, readJSONBody } from 'ohnejs';
import { isEmpty, isString, isUndefined } from 'ohnejs/utils';

import type { Passkey } from '../../../auth/types.ts';

import { requirePasskeys, toPasskey } from '../../../auth/_passkeys.ts';
import { requireFreshSession } from '../../../auth/_reauth.ts';

/**
 * `PATCH /auth/passkey/[uuid]`
 *
 * Renames one of the signed-in user's passkeys from `{ name }` and answers it.
 * A user who has not proved who they are within `auth.reauthMaxAge` gets the `403` of `requireFreshSession`.
 * A blank name is a `400`, and another user's passkey a `404`.
 * No signed-in user is a `401`; while `auth.passkeys` is off, it answers `404`.
 */
export default defineHandler(async ({ params }): Promise<Passkey> => {
  requirePasskeys();
  const { user } = await requireFreshSession();
  const body = await readJSONBody<{ name?: unknown } | null>();
  const name = isString(body?.name) ? body.name.trim() : '';
  if (isEmpty(name)) throw badRequest();
  const [record] = await queryUntyped('Passkeys')
    .where({ UUID: params.uuid, user: user.UUID })
    .updateOrThrow({ name });
  if (isUndefined(record)) throw notFound();
  return toPasskey(record);
});
