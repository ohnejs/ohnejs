import type { HighlightToken } from './highlight-token.ts';

import { lowercase } from '../case/lowercase.ts';
import { createRegistry } from '../registry/create-registry.ts';
import { tokenizeCSS } from './languages/css.ts';
import { tokenizeGitignore } from './languages/gitignore.ts';
import { tokenizeHTML } from './languages/html.ts';
import { tokenizeJSON } from './languages/json.ts';
import { tokenizeMarkdown } from './languages/markdown.ts';
import { tokenizeShell } from './languages/sh.ts';
import { tokenizeSQL } from './languages/sql.ts';
import { tokenizeTS } from './languages/ts.ts';
import { tokenizeXML } from './languages/xml.ts';
import { tokenizeYAML } from './languages/yaml.ts';

/**
 * Turns source code into its classified spans.
 */
export type Tokenizer = (code: string) => HighlightToken[];

/**
 * A registered language: its canonical name and its tokenizer.
 */
export interface HighlightLanguage {
  /**
   * The canonical name, the first one it was registered under.
   */
  name: string;

  /**
   * Classifies the language's source code.
   */
  tokenizer: Tokenizer;
}

const languages = createRegistry<HighlightLanguage>();

/**
 * Registers a highlighting language under every name in `names`, lowercased.
 * The first name is canonical; the rest are aliases and file extensions that resolve to it.
 * A name registered again is taken over by the newer language, so a closer layer wins.
 *
 * @example
 * ```ts
 * const grammar = /(;[^\n]*)|[^;]+/y
 * const classify = (match: RegExpExecArray) => (match[1] ? 'comment' : undefined)
 * registerLanguage(['ini', 'cfg'], (code) => scanTokens(code, grammar, classify))
 * languageOf('setup.cfg') // -> 'ini'
 * ```
 */
export function registerLanguage(
  names: readonly [string, ...string[]],
  tokenizer: Tokenizer,
): void {
  const name = lowercase(names[0]);
  for (const alias of names) languages.register(lowercase(alias), { name, tokenizer });
}

/**
 * Returns the language registered under `name` exactly, alias included, or `undefined`.
 * `languageOf` resolves a looser name or a file path.
 *
 * @example
 * ```ts
 * findLanguage('typescript')?.name // -> 'ts'
 * findLanguage('text')             // -> undefined
 * ```
 */
export function findLanguage(name: string): HighlightLanguage | undefined {
  return languages.get(name);
}

registerLanguage(
  ['ts', 'typescript', 'js', 'javascript', 'mjs', 'cjs', 'mts', 'cts', 'jsx', 'tsx'],
  tokenizeTS,
);
registerLanguage(['json'], tokenizeJSON);
registerLanguage(['jsonc'], tokenizeJSON);
registerLanguage(['sh', 'bash', 'shell', 'zsh'], tokenizeShell);
registerLanguage(['gitignore'], tokenizeGitignore);
registerLanguage(['css'], tokenizeCSS);
registerLanguage(['html', 'htm', 'xhtml'], tokenizeHTML);
registerLanguage(['markdown', 'md'], tokenizeMarkdown);
registerLanguage(['sql'], tokenizeSQL);
registerLanguage(['yaml', 'yml'], tokenizeYAML);
registerLanguage(['xml', 'svg', 'xsl', 'xslt', 'plist', 'rss', 'atom'], tokenizeXML);
