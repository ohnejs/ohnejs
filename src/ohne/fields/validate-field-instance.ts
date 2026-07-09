import type { FieldInstance } from './field.ts';
import type { FieldTypeName } from './known-fields.ts';

import { ohneError } from '../error/ohne-error.ts';

/**
 * Validates a field instance's options.
 *
 * - `unique` and `index` are mutually exclusive; a field is one or the other.
 */
export function validateFieldInstance<K extends FieldTypeName>(instance: FieldInstance<K>): void {
  const { options } = instance;
  if (options.unique === true && options.index === true) {
    throw ohneError({
      title: 'Field option `unique` conflicts with `index`',
      body: ['A field is either unique or plainly indexed, not both.', 'Drop one of the two.'],
    });
  }
}
