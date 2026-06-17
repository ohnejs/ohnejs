import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { quote } from '../../../src/utils/codegen/index.ts';

describe('quote', () => {
  it('wraps a plain string in single quotes', () => {
    strictEqual(quote('./pages/index.ts'), "'./pages/index.ts'");
  });

  it('escapes single quotes', () => {
    strictEqual(quote("it's"), "'it\\'s'");
  });

  it('escapes backslashes', () => {
    strictEqual(quote('C:\\app'), "'C:\\\\app'");
  });

  it('escapes whitespace control characters', () => {
    strictEqual(quote('a\nb\rc\td'), "'a\\nb\\rc\\td'");
  });

  it('escapes line and paragraph separators', () => {
    strictEqual(quote('a\u2028b\u2029c'), "'a\\u2028b\\u2029c'");
  });

  it('escapes a mix in one pass without touching double quotes', () => {
    strictEqual(quote('mix\'d\\ "q"\n'), "'mix\\'d\\\\ \"q\"\\n'");
  });
});
