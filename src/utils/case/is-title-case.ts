const TITLE_CASE = /^[A-Z0-9][A-Za-z0-9]*(?: [A-Z0-9][A-Za-z0-9]*)*$/;

/**
 * Returns `true` when `input` is canonical `Title Case`.
 * Every space-separated word starts uppercase or with a digit.
 * Single-space joined, no leading or trailing whitespace.
 *
 * Acronyms (`HTML`, `API`) qualify since they start uppercase.
 * Matches `toTitleCase` output.
 *
 * @example
 * ```ts
 * isTitleCase('First Name')       // -> true
 * isTitleCase('Parse HTML')       // -> true
 * isTitleCase('Get API Response') // -> true
 * isTitleCase('First name')       // -> false
 * isTitleCase('firstName')        // -> false
 * isTitleCase('First  Name')      // -> false
 * isTitleCase('')                 // -> false
 * ```
 */
export function isTitleCase(input: string): boolean {
  return TITLE_CASE.test(input);
}
