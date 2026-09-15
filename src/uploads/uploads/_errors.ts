import type { Message } from 'ohnejs';

import { isUndefined } from 'ohnejs/utils';

import {
  type FieldErrors,
  validationError,
  type ValidationError,
} from '../../ohne/query/write/errors.ts';

/**
 * The `422` a helper raises at one field with an `uploads.errors.*` message.
 * Once `KnownMessages` has keys, the object must name one of them.
 * In this repo's typecheck only test fixtures supply those keys, so the cast bridges it.
 */
export function uploadsError(
  field: string,
  error: string,
  params?: Record<string, unknown>,
): ValidationError {
  const key = `uploads.errors.${error}`;
  const message = (isUndefined(params) ? key : { key, params }) as unknown as Message;
  return validationError({ [field]: message });
}

/**
 * Whether every failure in `errors` is a `notUnique`, the shape a lost naming race leaves behind.
 */
export function isNotUnique(errors: FieldErrors): boolean {
  const messages = Object.values(errors);
  return messages.length > 0 && messages.every((message) => message === 'validation.notUnique');
}
