import type { HighlightToken } from './highlight-token.ts';

import { lowercase } from '../case/lowercase.ts';
import { basename } from '../path/basename.ts';
import { findLanguage, type HighlightLanguage } from './register-language.ts';

/**
 * Resolves a language name, alias, file name or path to its canonical language name.
 * Case is ignored; a path contributes its last segment, and a name with a `.` its text after the last one.
 * Returns `undefined` for a language nothing registered.
 *
 * @example
 * ```ts
 * languageOf('collections/Posts.ts') // -> 'ts'
 * languageOf('.gitignore')           // -> 'gitignore'
 * languageOf('JSON')                 // -> 'json'
 * languageOf('jsonc')                // -> 'jsonc'
 * languageOf('text')                 // -> undefined
 * ```
 */
export function languageOf(nameOrPath: string): string | undefined {
  return resolveLanguage(nameOrPath)?.name;
}

/**
 * Splits `code` into classified spans in the language `languageOf` resolves `language` to.
 * An unknown language yields no tokens, so the code renders plain.
 *
 * @example
 * ```ts
 * tokenize('// hi', 'ts')   // -> [{ kind: 'comment', start: 0, end: 5 }]
 * tokenize('// hi', 'text') // -> []
 * ```
 */
export function tokenize(code: string, language: string): HighlightToken[] {
  return resolveLanguage(language)?.tokenizer(code) ?? [];
}

/**
 * Looks up the language a name, alias, file name or path resolves to.
 */
function resolveLanguage(nameOrPath: string): HighlightLanguage | undefined {
  const name = basename(lowercase(nameOrPath));
  return findLanguage(name.slice(name.lastIndexOf('.') + 1));
}
