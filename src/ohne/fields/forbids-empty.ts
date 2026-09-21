import { isNumber, isUndefined } from '../../utils/index.ts';

/**
 * Whether a list field's options rule out the empty list: `allowEmpty: false`, or a `min` of at least 1.
 * Only a list-valued field may be asked: `text` spells other rules with the same option names.
 */
export function forbidsEmpty(options: Readonly<Record<string, unknown>> | undefined): boolean {
  if (isUndefined(options)) return false;
  return options.allowEmpty === false || (isNumber(options.min) && options.min >= 1);
}
