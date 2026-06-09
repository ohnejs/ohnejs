import { capitalize } from './capitalize.ts';
import { splitTokens } from './split-tokens.ts';

const ACRONYM = /^[A-Z0-9]{2,}$/;

/**
 * Converts a string to `Sentence case`.
 * Only the first word is capitalized; the rest are lowercased.
 *
 * Acronyms (length 2+, uppercase or digits) are preserved.
 * `parseHTML` becomes `Parse HTML`, not `Parse html`.
 *
 * @example
 * ```ts
 * toSentenceCase('firstName')      // -> 'First name'
 * toSentenceCase('parseHTML')      // -> 'Parse HTML'
 * toSentenceCase('getAPIResponse') // -> 'Get API response'
 * toSentenceCase('HTML')           // -> 'HTML'
 * toSentenceCase('')               // -> ''
 * ```
 */
export function toSentenceCase(input: string): string {
  return splitTokens(input)
    .map((token, i) => {
      if (ACRONYM.test(token)) return token;
      if (i === 0) return capitalize(token.toLowerCase());
      return token.toLowerCase();
    })
    .join(' ');
}
