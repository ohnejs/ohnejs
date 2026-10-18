import type { NumberFieldOptions } from '../known-field-types.ts';

import { type FieldType, registerFieldType } from '../field-type.ts';
import { parseRealValue } from '../parse.ts';
import { numericFieldType } from './_numeric.ts';

/**
 * The `number` field type: cell display, inline cell editor, form control, summary, and filter.
 * The editor and control parse entry strictly to a finite double.
 * The control validates on blur and on read, and steps on the arrow keys as `numericFieldType` describes.
 */
export const numberType: FieldType<NumberFieldOptions> = numericFieldType({
  parse: parseRealValue,
  decimal: true,
});

registerFieldType('number', numberType);
