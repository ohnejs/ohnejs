import type { Prepared } from './run-record.ts';

import { isUndefined } from '../../../utils/index.ts';

/**
 * One scope's coerced field values, keyed by field name, the substrate a `when` resolves against.
 */
export type ScopeValues = Record<string, unknown>;

/**
 * Snapshots a scope's coerced values from its phase-A results, so `when` reads siblings, never raw input.
 * A provided composite contributes its coerced `snapshot`, so a gate walking it reads defaulted items.
 * A field that skipped or failed phase A contributes no value; a `when` reading it resolves to `undefined`.
 */
export function scopeValuesOf(
  names: readonly string[],
  prepared: Record<string, Prepared>,
): ScopeValues {
  const values: ScopeValues = {};
  for (const name of names) {
    const entry = prepared[name];
    if (isUndefined(entry) || !('value' in entry)) continue;
    values[name] = 'snapshot' in entry ? entry.snapshot : entry.value;
  }
  return values;
}
