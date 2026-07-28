import type { RoleDefinition } from './define-role.ts';

import { isArray, isString } from '../../utils/index.ts';
import { ohneError } from '../error/ohne-error.ts';

/**
 * Validates a role definition.
 * `capabilities` must be an array of non-empty strings.
 */
export function validateRoleDefinition(definition: RoleDefinition): void {
  const capabilities: unknown = definition.capabilities;
  if (!isArray(capabilities) || !capabilities.every((entry) => isString(entry) && entry !== '')) {
    throw ohneError({
      title: 'Invalid role definition',
      body: ['`capabilities` must be an array of non-empty capability strings.'],
    });
  }
}
