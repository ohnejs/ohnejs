import type { ValidationFailure } from '../../utils/index.ts';
import type { UncheckedMessage } from '../messages/known-messages.ts';

import { isString, isUndefined } from '../../utils/index.ts';

/**
 * A parameterized `validation.*` failure as its `{ key, params }` message object.
 * The keys live in the `ohnejs/base` catalog, which an app can disable, so `KnownMessages` may lack them.
 * The cast therefore brands the object an `UncheckedMessage`.
 */
export function validationMessage(
  key: `validation.${string}`,
  params: Record<string, unknown>,
): UncheckedMessage {
  return { key, params } as UncheckedMessage;
}

/**
 * A shared check's failure as the message a validator returns; a pass stays `undefined`.
 * A bare key stays the key, and a parameterized one becomes its `validationMessage` object.
 */
export function failureMessage(
  failure: ValidationFailure | undefined,
): `validation.${string}` | UncheckedMessage | undefined {
  if (isUndefined(failure) || isString(failure)) return failure;
  return validationMessage(failure.key, failure.params);
}
