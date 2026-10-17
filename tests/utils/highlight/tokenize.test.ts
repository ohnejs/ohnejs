import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { languageOf, tokenize } from '../../../src/utils/highlight/tokenize.ts';

describe('languageOf', () => {
  it('resolves aliases to the canonical name', () => {
    strictEqual(languageOf('typescript'), 'ts');
    strictEqual(languageOf('tsx'), 'ts');
    strictEqual(languageOf('bash'), 'sh');
    strictEqual(languageOf('zsh'), 'sh');
  });

  it('ignores case', () => {
    strictEqual(languageOf('JSON'), 'json');
    strictEqual(languageOf('TypeScript'), 'ts');
  });

  it('reads the extension of a file name or path', () => {
    strictEqual(languageOf('collections/Posts.ts'), 'ts');
    strictEqual(languageOf('src/types.d.ts'), 'ts');
    strictEqual(languageOf('C:\\app\\tsconfig.JSON'), 'json');
    strictEqual(languageOf('run.sh'), 'sh');
  });

  it('reads a dotfile by its name', () => {
    strictEqual(languageOf('.gitignore'), 'gitignore');
    strictEqual(languageOf('web/.gitignore'), 'gitignore');
  });

  it('keeps `jsonc` its own language', () => {
    strictEqual(languageOf('jsonc'), 'jsonc');
    strictEqual(languageOf('.vscode/settings.jsonc'), 'jsonc');
  });

  it('returns undefined for an unknown language', () => {
    strictEqual(languageOf('text'), undefined);
    strictEqual(languageOf('notes.txt'), undefined);
    strictEqual(languageOf('Makefile'), undefined);
    strictEqual(languageOf('json.'), undefined);
    strictEqual(languageOf(''), undefined);
  });
});

describe('tokenize', () => {
  it('tokenizes in the resolved language', () => {
    deepStrictEqual(tokenize('// hi', 'ts'), [{ kind: 'comment', start: 0, end: 5 }]);
    deepStrictEqual(tokenize('# hi', 'deploy.sh'), [{ kind: 'comment', start: 0, end: 4 }]);
  });

  it('returns no tokens for an unknown language', () => {
    deepStrictEqual(tokenize('// hi', 'text'), []);
    deepStrictEqual(tokenize('// hi', ''), []);
  });
});
