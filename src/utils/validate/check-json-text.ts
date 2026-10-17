import type { ValidationFailure } from './validation-failure.ts';

/**
 * Fails text that does not parse as JSON, as `validation.invalidJSON`.
 *
 * @example
 * ```ts
 * checkJSONText('{ "level": 60 }') // -> undefined
 * checkJSONText('{ level: 60 }')   // -> 'validation.invalidJSON'
 * checkJSONText('')                // -> 'validation.invalidJSON'
 * ```
 */
export function checkJSONText(value: string): ValidationFailure | undefined {
  try {
    JSON.parse(value);
    return undefined;
  } catch {
    return 'validation.invalidJSON';
  }
}
