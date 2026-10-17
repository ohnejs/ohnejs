import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { findLanguage, registerLanguage } from '../../../src/utils/highlight/register-language.ts';

const tokenizer = (code: string) => [{ kind: 'tag' as const, start: 0, end: code.length }];

describe('registerLanguage', () => {
  it('resolves every alias to the first, canonical name', () => {
    registerLanguage(['vue', 'vue3'], tokenizer);
    strictEqual(findLanguage('vue3')?.name, 'vue');
    strictEqual(findLanguage('vue3')?.tokenizer, tokenizer);
  });

  it('lowercases every name', () => {
    registerLanguage(['Svelte', 'SV'], tokenizer);
    strictEqual(findLanguage('sv')?.name, 'svelte');
    strictEqual(findLanguage('Svelte'), undefined);
  });

  it('lets a newer language take over a name', () => {
    registerLanguage(['typescript'], tokenizer);
    deepStrictEqual(findLanguage('typescript')?.tokenizer('ab'), [
      { kind: 'tag', start: 0, end: 2 },
    ]);
    strictEqual(findLanguage('ts')?.name, 'ts');
  });
});

describe('findLanguage', () => {
  it('finds each builtin by its canonical name', () => {
    for (const name of ['ts', 'json', 'jsonc', 'sh', 'gitignore']) {
      strictEqual(findLanguage(name)?.name, name);
    }
  });

  it('returns undefined for an unknown name', () => {
    strictEqual(findLanguage('text'), undefined);
  });
});
