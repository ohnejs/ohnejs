import { deepStrictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { tokenizeTS } from '../../../../src/utils/highlight/languages/ts.ts';

const spans = (code: string) => tokenizeTS(code).map((t) => [t.kind, code.slice(t.start, t.end)]);

describe('tokenizeTS', () => {
  it('classifies comments', () => {
    deepStrictEqual(spans('// a\n/* b */'), [
      ['comment', '// a'],
      ['comment', '/* b */'],
    ]);
  });

  it('classifies every string quote', () => {
    deepStrictEqual(spans(`'a' "b\\"" \`c\n\${d}\``), [
      ['string', "'a'"],
      ['string', '"b\\""'],
      ['string', '`c\n${d}`'],
    ]);
  });

  it('classifies numbers', () => {
    deepStrictEqual(spans('1_000 0xFF 1.5e-3'), [
      ['number', '1_000'],
      ['number', '0xFF'],
      ['number', '1.5e-3'],
    ]);
  });

  it('classifies keywords, types and function calls', () => {
    deepStrictEqual(spans('const p: Post = load()'), [
      ['keyword', 'const'],
      ['type', 'Post'],
      ['function', 'load'],
    ]);
  });

  it('never reads a member as a keyword', () => {
    deepStrictEqual(spans('a.default + a.delete + a?.new'), []);
  });

  it('reads a keyword after a spread as a keyword', () => {
    deepStrictEqual(spans('[...new X]'), [
      ['keyword', 'new'],
      ['type', 'X'],
    ]);
  });

  it('ends an unterminated string at its line', () => {
    deepStrictEqual(spans("'open\nconst"), [
      ['string', "'open"],
      ['keyword', 'const'],
    ]);
  });

  it('runs an unterminated block comment to the end', () => {
    deepStrictEqual(spans('a /* b\nconst c'), [['comment', '/* b\nconst c']]);
  });

  it('runs an unterminated template to the end', () => {
    deepStrictEqual(spans('`a\nconst'), [['string', '`a\nconst']]);
  });

  it('leaves a division plain', () => {
    deepStrictEqual(spans('a / b'), []);
  });
});
