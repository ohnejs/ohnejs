import type { ValidationFailure } from '../../utils/validate/validation-failure.ts';
import type { ControlReading } from './field-type.ts';

import { isUndefined } from '../../utils/is/is-undefined.ts';
import { translateMessage } from '../runtime/use-t.ts';

/**
 * A control's reading of `value`: the value itself, or the failure's message keyed on the control.
 */
export function checkedReading(
  value: unknown,
  failure: ValidationFailure | undefined,
): ControlReading {
  return isUndefined(failure) ? { value } : { errors: { '': translateMessage(failure) } };
}
