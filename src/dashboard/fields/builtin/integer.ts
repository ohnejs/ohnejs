import type { IntegerFieldOptions } from '../known-field-types.ts';

import { type FieldType, registerFieldType } from '../field-type.ts';
import { parseIntegerValue } from '../parse.ts';
import { amountNotation } from './_amount.ts';
import { numericFieldType } from './_numeric.ts';

/**
 * The `integer` field type: cell display, inline cell editor, form control, summary, and filter.
 * The editor and control take any decimal notation of a safe integer, like `1e3`, and refuse fractions.
 * The control validates on blur and on read, and steps on the arrow keys as `numericFieldType` describes.
 * With a `currency` every view reads and writes the value as an amount, as `amountNotation` describes.
 */
export const integerType: FieldType<IntegerFieldOptions> = numericFieldType({
  parse: parseIntegerValue,
  decimal: false,
  notation: amountNotation,
});

registerFieldType('integer', integerType);
