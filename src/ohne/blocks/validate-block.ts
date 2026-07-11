import type { FieldInstance } from '../fields/field.ts';
import type { BlockDefinition } from './define-block.ts';

import { validateFieldName, validateUniqueNames } from '../database/naming/validate-names.ts';

/**
 * Validates a block definition.
 *
 * - Field names must be camelCase, non-reserved, and case-insensitively unique.
 * - A known block name sharpens the messages; omit it before the name is known.
 */
export function validateBlockDefinition<TFields extends Record<string, FieldInstance>>(
  definition: BlockDefinition<TFields>,
  block?: string,
): void {
  const fieldNames = Object.keys(definition.fields);
  for (const name of fieldNames) validateFieldName(name, block);
  validateUniqueNames(fieldNames, 'field', block);
}
