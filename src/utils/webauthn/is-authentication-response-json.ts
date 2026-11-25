import type { AuthenticationResponseJSON } from './verify-webauthn-authentication.ts';

import { isPlainObject } from '../is/is-plain-object.ts';
import { isString } from '../is/is-string.ts';

/**
 * Whether an untrusted `value`, such as a request body field, has the shape of a sign-in's JSON.
 * It checks the shape only; `verifyWebAuthnAuthentication` checks the contents.
 *
 * @example
 * ```ts
 * isAuthenticationResponseJSON(body.credential) // -> true
 * isAuthenticationResponseJSON({ id: 'x' })     // -> false
 * ```
 */
export function isAuthenticationResponseJSON(value: unknown): value is AuthenticationResponseJSON {
  if (!isPlainObject(value) || !isString(value.id) || !isString(value.type)) return false;
  const { response } = value;
  return (
    isPlainObject(response) &&
    isString(response.clientDataJSON) &&
    isString(response.authenticatorData) &&
    isString(response.signature)
  );
}
