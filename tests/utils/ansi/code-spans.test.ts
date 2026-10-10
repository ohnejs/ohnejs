import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { codeSpan, codeSpans } from '../../../src/utils/ansi/index.ts';

const spans = (text: string, escapes = false) =>
  [...codeSpans(text, escapes).ends].map(([start, end]) => text.slice(start, end));

describe('codeSpans', () => {
  it('closes a span only at a backtick run of its own length', () => {
    deepStrictEqual(spans('a ``b`c`` d'), ['``b`c``']);
    deepStrictEqual(spans('``a`'), []);
    deepStrictEqual(spans('`a``b`'), ['`a``b`']);
  });

  it('opens no span inside a longer run', () => {
    deepStrictEqual(spans('```a`'), []);
  });

  it('binds spans left to right', () => {
    deepStrictEqual(spans('`a` `b`'), ['`a`', '`b`']);
    deepStrictEqual(spans('`a ``b` c``'), ['`a ``b`']);
  });

  it('keeps a span on one line, across a line separator', () => {
    deepStrictEqual(spans('`a\nb`'), []);
    deepStrictEqual(spans('`a\u2028b`'), ['`a\u2028b`']);
  });

  it('opens no span at an escaped backtick when escapes are on', () => {
    deepStrictEqual(spans('\\`a`'), ['`a`']);
    deepStrictEqual(spans('\\`a`', true), []);
    deepStrictEqual(spans('\\\\`a`', true), ['`a`']);
    deepStrictEqual(spans('`a\\`', true), ['`a\\`']);
  });

  it('makes only the first backtick of an escaped run literal, so the rest may still open', () => {
    deepStrictEqual(spans('\\``x`', true), ['`x`']);
    deepStrictEqual(spans('\\```x``', true), ['``x``']);
    deepStrictEqual(spans('a \\``b`` c`', true), ['`b`` c`']);
    deepStrictEqual(spans('\\\\``x``', true), ['``x``']);
  });

  it('blanks each span content and keeps every offset', () => {
    const { masked } = codeSpans('**`a**` b');
    strictEqual(masked.length, 9);
    strictEqual(masked.replace(/\uE000/g, '.'), '**`...` b');
  });

  it('reads back every fence `codeSpan` writes', () => {
    for (const value of ['a', 'a`b', '``', '`x', 'x`', ' a ', '```a``b`']) {
      deepStrictEqual(spans(`x ${codeSpan(value)} y`), [codeSpan(value)]);
    }
  });

  it('stays linear on many unclosed runs', () => {
    const text = Array.from({ length: 2000 }, (_, index) => '`'.repeat(index + 1)).join('a');
    const started = performance.now();
    codeSpans(text);
    ok(performance.now() - started < 1000);
  });
});
