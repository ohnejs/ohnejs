import { deepStrictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { tokenizeJSON } from '../../../../src/utils/highlight/languages/json.ts';

const spans = (code: string) => tokenizeJSON(code).map((t) => [t.kind, code.slice(t.start, t.end)]);

describe('tokenizeJSON', () => {
  it('classifies properties, strings, numbers and literals', () => {
    deepStrictEqual(spans('{"a" : "b", "c": [-1.5e2, true, null]}'), [
      ['property', '"a"'],
      ['string', '"b"'],
      ['property', '"c"'],
      ['number', '-1.5e2'],
      ['keyword', 'true'],
      ['keyword', 'null'],
    ]);
  });

  it('keeps an escaped quote inside its string', () => {
    deepStrictEqual(spans('["a\\"b"]'), [['string', '"a\\"b"']]);
  });

  it('ends an unterminated string at its line', () => {
    deepStrictEqual(spans('"open\n1'), [
      ['string', '"open'],
      ['number', '1'],
    ]);
  });

  it('classifies a comment inside `jsonc`', () => {
    deepStrictEqual(spans('{\n  // a\n  "b": 1 /* c */\n}'), [
      ['comment', '// a'],
      ['property', '"b"'],
      ['number', '1'],
      ['comment', '/* c */'],
    ]);
  });

  it('runs an unterminated comment to the end', () => {
    deepStrictEqual(spans('1 /* a\n2'), [
      ['number', '1'],
      ['comment', '/* a\n2'],
    ]);
  });

  it('leaves a lone slash and a bare word plain', () => {
    deepStrictEqual(spans('/ truthy'), []);
  });
});
