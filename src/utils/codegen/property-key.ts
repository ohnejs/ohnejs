import { literalString } from './literal-string.ts';

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * Formats `name` as an object property key, quoting it only when it is not a valid identifier.
 *
 * A valid identifier is emitted bare; anything else is quoted via `literalString`.
 *
 * @example
 * ```ts
 * propertyKey('codegen') // -> 'codegen'
 * propertyKey('a-b')     // -> "'a-b'"
 * propertyKey('2cool')   // -> "'2cool'"
 * ```
 */
export function propertyKey(name: string): string {
  return IDENTIFIER.test(name) ? name : literalString(name);
}
