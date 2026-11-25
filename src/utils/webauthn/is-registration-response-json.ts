import type { RegistrationResponseJSON } from './verify-webauthn-registration.ts';

import { isArray } from '../is/is-array.ts';
import { isPlainObject } from '../is/is-plain-object.ts';
import { isString } from '../is/is-string.ts';
import { isUndefined } from '../is/is-undefined.ts';

/**
 * Whether an untrusted `value`, such as a request body field, has the shape of a new credential's JSON.
 * It checks the shape only; `verifyWebAuthnRegistration` checks the contents.
 *
 * @example
 * ```ts
 * isRegistrationResponseJSON(body.credential) // -> true
 * isRegistrationResponseJSON({ id: 'x' })     // -> false
 * ```
 */
export function isRegistrationResponseJSON(value: unknown): value is RegistrationResponseJSON {
  if (!isPlainObject(value) || !isString(value.id) || !isString(value.type)) return false;
  const { response } = value;
  return (
    isPlainObject(response) &&
    isString(response.clientDataJSON) &&
    isString(response.attestationObject) &&
    (isUndefined(response.transports) ||
      (isArray(response.transports) && response.transports.every(isString)))
  );
}
