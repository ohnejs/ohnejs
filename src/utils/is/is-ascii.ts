const ASCII = /^\p{ASCII}*$/u;

/**
 * Checks whether a string holds ASCII characters alone, code points `0` to `127`.
 *
 * @example
 * ```ts
 * isASCII('Hello') // -> true
 * isASCII('Émile') // -> false
 * ```
 */
export function isASCII(value: string): boolean {
  return ASCII.test(value);
}
