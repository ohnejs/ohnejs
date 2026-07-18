import type { Prepared } from './run-record.ts';

import { hasKey, isPlainObject, isUndefined } from '../../../utils/index.ts';

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

/**
 * Builds the path resolver a `when` evaluates through, closing over the scope and its ancestry.
 *
 * A bare path reads the current scope; a leading `/` reads the record root; each `..` climbs one level.
 * The ancestry runs root-first, so `..` steps back through it and a climb past the root resolves to nothing.
 * Remaining segments then descend by plain own-property lookup, exactly as the evaluator reads a `has` item.
 */
export function whenResolver(
  scope: ScopeValues,
  ancestors: readonly ScopeValues[],
): (path: readonly string[]) => unknown {
  const stack = [...ancestors, scope];
  return (segments) => {
    let index = stack.length - 1;
    let cursor = 0;
    if (segments[cursor] === '/') {
      index = 0;
      cursor += 1;
    }
    while (segments[cursor] === '..') {
      index -= 1;
      cursor += 1;
    }
    if (index < 0) return undefined;
    let value: unknown = stack[index];
    for (; cursor < segments.length; cursor += 1) {
      if (!isPlainObject(value)) return undefined;
      value = hasKey(value, segments[cursor]) ? value[segments[cursor]] : undefined;
    }
    return value;
  };
}
