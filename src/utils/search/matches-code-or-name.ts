import { foldCase } from '../case/fold-case.ts';
import { matchesWordStart } from './matches-word-start.ts';

/**
 * Checks whether a search token finds a coded value: the exact code in any case, or a word start of its name.
 * A piece from the middle of the name finds nothing, so `land` never finds every country ending in it.
 *
 * @example
 * ```ts
 * matchesCodeOrName('DE', 'Deutschland', 'de')   // -> true
 * matchesCodeOrName('DE', 'Deutschland', 'deut') // -> true
 * matchesCodeOrName('DE', 'Deutschland', 'land') // -> false
 * ```
 */
export function matchesCodeOrName(code: string, name: string, token: string): boolean {
  return foldCase(code) === foldCase(token) || matchesWordStart(name, token);
}
