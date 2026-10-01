import { foldCase } from '../case/fold-case.ts';

/**
 * Checks whether a word of `text` starts with `prefix`, ignoring case.
 * A word starts at the text's start or after any character that is not a letter, digit, or mark.
 * Both sides are NFC-normalized and folded with `foldCase`, and the prefix is taken literally.
 * A prefix holding a space matches across words, so a quoted phrase works too.
 *
 * @example
 * ```ts
 * matchesWordStart('In progress', 'prog') // -> true
 * matchesWordStart('Published', 'PUB')    // -> true
 * matchesWordStart('Published', 'lish')   // -> false
 * ```
 */
export function matchesWordStart(text: string, prefix: string): boolean {
  const needle = RegExp.escape(foldCase(prefix.normalize('NFC')));
  return new RegExp(`(?<![\\p{L}\\p{N}\\p{M}])${needle}`, 'u').test(
    foldCase(text.normalize('NFC')),
  );
}
