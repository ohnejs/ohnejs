import { capitalize } from './capitalize.ts';
import { splitTokens } from './split-tokens.ts';

const ACRONYM = /^[A-Z0-9]{2,}$/;

/**
 * Converts a string to `Title Case`.
 * Every word is capitalized, joined by single spaces.
 *
 * Acronyms (length 2+, uppercase or digits) are preserved.
 * `parseHTML` becomes `Parse HTML`, not `Parse Html`.
 *
 * @example
 * ```ts
 * toTitleCase('firstName')      // -> 'First Name'
 * toTitleCase('parseHTML')      // -> 'Parse HTML'
 * toTitleCase('getAPIResponse') // -> 'Get API Response'
 * toTitleCase('HTML')           // -> 'HTML'
 * toTitleCase('')               // -> ''
 * ```
 */
export function toTitleCase(input: string): string {
  return splitTokens(input)
    .map((token) => (ACRONYM.test(token) ? token : capitalize(token.toLowerCase())))
    .join(' ');
}
