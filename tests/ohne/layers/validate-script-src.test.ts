import { doesNotThrow, strictEqual, throws } from 'node:assert';
import { describe, it } from 'node:test';

import { validateScriptSrc } from '../../../src/ohne/index.ts';

const file = '/app/ohne.config.ts';

describe('validateScriptSrc', () => {
  it('accepts single sources and an empty list', () => {
    doesNotThrow(() => validateScriptSrc(['https://cdn.example.com', "'wasm-unsafe-eval'"], file));
    doesNotThrow(() => validateScriptSrc([], file));
  });

  it('refuses an entry that would add sources or directives', () => {
    for (const entry of [
      'https://a.example.com; script-src *',
      'https://a.example.com *',
      'a,b',
      '',
    ]) {
      throws(
        () => validateScriptSrc([entry], file),
        (error: { title: string; path: string }) => {
          strictEqual(error.path, file);
          return error.title.startsWith('Invalid script source');
        },
      );
    }
  });
});
