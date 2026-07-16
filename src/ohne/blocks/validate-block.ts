import type { FieldInstance } from '../fields/field.ts';
import type { BlockDefinition } from './define-block.ts';

import { isUndefined } from '../../utils/index.ts';
import { validateFieldName, validateUniqueNames } from '../database/naming/validate-names.ts';
import { ohneError } from '../error/ohne-error.ts';

/**
 * Validates a block definition.
 *
 * - Field names must be camelCase, non-reserved, and case-insensitively unique.
 * - `block` is additionally reserved: it is the discriminator key beside a block's own fields,
 *   in the read shape, the write input, and a blocks `has` scope alike.
 * - A known block name sharpens the messages; omit it before the name is known.
 */
export function validateBlockDefinition<TFields extends Record<string, FieldInstance>>(
  definition: BlockDefinition<TFields>,
  block?: string,
): void {
  const fieldNames = Object.keys(definition.fields);
  for (const name of fieldNames) {
    validateFieldName(name, block);
    if (name.toLowerCase() !== 'block') continue;
    const where = isUndefined(block) ? '' : ` in \`${block}\``;
    throw ohneError({
      title: `Field name \`${name}\` is reserved`,
      body: [
        "`block` is the discriminator key beside a block's own fields, so no field may claim it.",
        `Rename it${where}.`,
      ],
    });
  }
  validateUniqueNames(fieldNames, 'field', block);
}
