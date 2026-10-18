import type { NumberFieldOptions } from '../known-field-types.ts';

import { type FieldType, registerFieldType } from '../field-type.ts';
import { parseIntegerValue } from '../parse.ts';
import { numericFieldType } from './_numeric.ts';

/**
 * The `integer` field type: cell display, inline cell editor, form control, summary, and filter.
 * The editor and control take any decimal notation of a safe integer, like `1e3`, and refuse fractions.
 * The control validates on blur and on read, and steps on the arrow keys as `numericFieldType` describes.
 */
export const integerType: FieldType<NumberFieldOptions> = numericFieldType({
  parse: parseIntegerValue,
  decimal: false,
});

registerFieldType('integer', integerType);
