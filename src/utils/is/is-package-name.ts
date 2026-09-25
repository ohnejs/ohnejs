import { isString } from './is-string.ts';

const NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;

/**
 * Checks whether a value is a lowercase, URL-safe package name of at most 214 characters.
 * It holds lowercase letters, digits, `-`, `.`, and `_`, and starts with a letter or digit.
 * A scoped name puts an `@scope/` of the same shape in front.
 *
 * Only the shape is checked, so a reserved name such as `node_modules` or `http` passes.
 *
 * @example
 * ```ts
 * isPackageName('my-app')   // -> true
 * isPackageName('@acme/ui') // -> true
 * isPackageName('my app')   // -> false
 * isPackageName('My-App')   // -> false
 * isPackageName('.hidden')  // -> false
 * ```
 */
export function isPackageName(value: unknown): value is string {
  return isString(value) && value.length <= 214 && NAME.test(value);
}
