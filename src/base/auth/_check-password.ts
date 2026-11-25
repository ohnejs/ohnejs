import { applyHook, queryUntyped, unauthorized } from 'ohnejs';
import { isString, isUndefined } from 'ohnejs/utils';
import { verifyPassword } from 'ohnejs/utils/crypto';

import { validationError } from '../../ohne/query/write/errors.ts';
import { enforceLoginRateLimit } from './_login-rate-limit.ts';
import { acquirePasswordPermit } from './_password-permits.ts';
import { dummyVerify } from './dummy-verify.ts';

/**
 * Answers `422` on `field` unless `password` is the one `user` signs in with.
 * The check holds a password permit and counts toward `auth.loginRateLimit`, like a sign-in.
 * A wrong one fires `auth:credential-rejected` once the permit is back.
 * A user that no longer exists is a `401`.
 */
export async function checkPassword(user: string, password: string, field: string): Promise<void> {
  const release = acquirePasswordPermit();
  const matches = await enforceLoginRateLimit()
    .then(() => passwordMatches(user, password))
    .finally(release);
  if (matches) return;
  await applyHook('auth:credential-rejected', { method: 'password', user });
  throw validationError({ [field]: 'auth.incorrectPassword' });
}

/**
 * Whether `password` is the one `user` signs in with; `401` when the user no longer exists.
 * A user without a password spends a `dummyVerify`, so the answer takes as long as a wrong one.
 */
async function passwordMatches(user: string, password: string): Promise<boolean> {
  const row = await queryUntyped('Users').select('password').where({ UUID: user }).findFirst();
  if (isUndefined(row)) throw unauthorized();
  if (isString(row.password)) return verifyPassword(password, row.password);
  await dummyVerify(password);
  return false;
}
