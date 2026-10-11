import type { DashboardField } from '../../runtime/meta-types.ts';

import { isArray } from '../../../utils/is/is-array.ts';
import { isPlainObject } from '../../../utils/is/is-plain-object.ts';
import { isString } from '../../../utils/is/is-string.ts';
import { translateMessage } from '../../runtime/use-t.ts';

/**
 * The declared `choices` option as resolved `value`/`label` pairs.
 * A plain string choice is its own display text; a declared label resolves as `Text`.
 * A malformed or absent option resolves to no choices.
 */
export function choicesOf(field: DashboardField): { value: string; label: string }[] {
  const declared = field.options?.choices;
  if (!isArray(declared)) return [];
  const pairs: { value: string; label: string }[] = [];
  for (const entry of declared) {
    if (isString(entry)) {
      pairs.push({ value: entry, label: entry });
    } else if (isPlainObject(entry) && isString(entry.value)) {
      pairs.push({ value: entry.value, label: translateMessage(entry.label) ?? entry.value });
    }
  }
  return pairs;
}
