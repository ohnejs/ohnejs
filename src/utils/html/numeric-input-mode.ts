import { isUndefined } from '../is/is-undefined.ts';

/**
 * The `inputmode` for a numeric text input: a digit pad when the value cannot go negative.
 * Without a non-negative `min` it returns `undefined`, so the full keyboard keeps its minus key.
 * The iOS digit pads have none.
 *
 * @example
 * ```ts
 * numericInputMode(0)         // -> 'numeric'
 * numericInputMode(0.5, true) // -> 'decimal'
 * numericInputMode(-10)       // -> undefined
 * numericInputMode(undefined) // -> undefined
 * ```
 */
export function numericInputMode(
  min: number | undefined,
  decimal = false,
): 'numeric' | 'decimal' | undefined {
  if (isUndefined(min) || min < 0) return undefined;
  return decimal ? 'decimal' : 'numeric';
}
