import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { literalString } from '../../../src/utils/codegen/index.ts';

describe('literalString', () => {
  it('wraps a plain string in single quotes', () => {
    strictEqual(literalString('./pages/index.ts'), "'./pages/index.ts'");
  });

  it('escapes single quotes', () => {
    strictEqual(literalString("it's"), "'it\\'s'");
  });

  it('escapes backslashes', () => {
    strictEqual(literalString('C:\\app'), "'C:\\\\app'");
  });

  it('escapes whitespace control characters', () => {
    strictEqual(literalString('a\nb\rc\td'), "'a\\nb\\rc\\td'");
  });

  it('escapes line and paragraph separators', () => {
    strictEqual(literalString('a\u2028b\u2029c'), "'a\\u2028b\\u2029c'");
  });

  it('escapes a mix in one pass without touching double quotes', () => {
    strictEqual(literalString('mix\'d\\ "q"\n'), "'mix\\'d\\\\ \"q\"\\n'");
  });
});
