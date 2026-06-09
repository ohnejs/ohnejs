const SENTENCE_CASE = /^(?:[A-Z][A-Za-z0-9]*|[0-9]+)(?: (?:[a-z0-9]+|[A-Z][A-Z0-9]*))*$/;

/**
 * Returns `true` when `input` is canonical `Sentence case`.
 * The first word starts uppercase or is digit-only.
 * Subsequent words are lowercase or all-uppercase acronyms.
 * Single-space joined.
 *
 * Matches `toSentenceCase` output.
 *
 * @example
 * ```ts
 * isSentenceCase('First name')       // -> true
 * isSentenceCase('Parse HTML')       // -> true
 * isSentenceCase('Get API response') // -> true
 * isSentenceCase('First Name')       // -> false
 * isSentenceCase('first name')       // -> false
 * isSentenceCase('First  name')      // -> false
 * isSentenceCase('')                 // -> false
 * ```
 */
export function isSentenceCase(input: string): boolean {
  return SENTENCE_CASE.test(input);
}
