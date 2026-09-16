import type { RoleDefinition } from './define-role.ts';

import { isArray, isPlainObject, isString, isUndefined } from '../../utils/index.ts';
import { ohneError } from '../error/ohne-error.ts';

/**
 * Validates a role definition.
 * `capabilities` must be an array of non-empty strings.
 * `label` and `description` are optional.
 * Each is a message key, a plain string, or a `{ key, params }` object.
 */
export function validateRoleDefinition(definition: RoleDefinition): void {
  const capabilities: unknown = definition.capabilities;
  if (!isArray(capabilities) || !capabilities.every((entry) => isString(entry) && entry !== '')) {
    throw ohneError({
      title: 'Invalid role definition',
      body: ['`capabilities` must be an array of non-empty capability strings.'],
    });
  }
  validateMessage(definition.label, 'label');
  validateMessage(definition.description, 'description');
}

/**
 * Rejects a declared message of the wrong shape.
 */
function validateMessage(message: unknown, option: string): void {
  if (isUndefined(message) || isString(message)) return;
  if (isPlainObject(message) && isString(message.key)) return;
  throw ohneError({
    title: 'Invalid role definition',
    body: [`\`${option}\` must be a message key, a plain string, or a \`{ key, params }\` object.`],
  });
}
