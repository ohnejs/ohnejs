import { deepStrictEqual, ok } from 'node:assert';
import { describe, it } from 'node:test';

import { tokenizeCSS } from '../../../../src/utils/highlight/languages/css.ts';

const spans = (code: string) => tokenizeCSS(code).map((t) => [t.kind, code.slice(t.start, t.end)]);

describe('tokenizeCSS', () => {
  it('classifies a rule with its selector and declarations', () => {
    deepStrictEqual(spans('a.b#c:hover::before { color: #fff; margin: -1.5em 0 50% }'), [
      ['tag', 'a'],
      ['attribute', '.b'],
      ['attribute', '#c'],
      ['type', 'hover'],
      ['type', 'before'],
      ['property', 'color'],
      ['number', '#fff'],
      ['property', 'margin'],
      ['number', '-1.5em'],
      ['number', '0'],
      ['number', '50%'],
    ]);
  });

  it('classifies functions, strings, custom properties and `!important`', () => {
    deepStrictEqual(
      spans(`:root { --gap: 4px; padding: calc(var(--gap) * 2) !important; font: 'Inter' }`),
      [
        ['type', 'root'],
        ['variable', '--gap'],
        ['number', '4px'],
        ['property', 'padding'],
        ['function', 'calc'],
        ['function', 'var'],
        ['variable', '--gap'],
        ['number', '2'],
        ['keyword', '!important'],
        ['property', 'font'],
        ['string', "'Inter'"],
      ],
    );
  });

  it('reads an unquoted `url()` as a string', () => {
    deepStrictEqual(spans('a { background: url(img/a.png) }'), [
      ['tag', 'a'],
      ['property', 'background'],
      ['function', 'url'],
      ['string', 'img/a.png'],
    ]);
  });

  it('keeps `;` and braces inside an unquoted `url()`', () => {
    deepStrictEqual(spans('a { b: url(data:x;base64,{}) no-repeat; c: d }'), [
      ['tag', 'a'],
      ['property', 'b'],
      ['function', 'url'],
      ['string', 'data:x;base64,{}'],
      ['property', 'c'],
    ]);
  });

  it('classifies an at-rule prelude', () => {
    deepStrictEqual(spans('@media screen and (min-width: 600px) { .a { b: 1 } }'), [
      ['keyword', '@media'],
      ['keyword', 'and'],
      ['property', 'min-width'],
      ['number', '600px'],
      ['attribute', '.a'],
      ['property', 'b'],
      ['number', '1'],
    ]);
  });

  it('classifies statement at-rules', () => {
    deepStrictEqual(spans('@import url("a.css") layer(base);\n@layer base, ui;'), [
      ['keyword', '@import'],
      ['function', 'url'],
      ['string', '"a.css"'],
      ['function', 'layer'],
      ['keyword', '@layer'],
    ]);
  });

  it('reads keyframe selectors and declarations', () => {
    deepStrictEqual(spans('@keyframes spin { from { a: 0 } 50% { a: 1turn } }'), [
      ['keyword', '@keyframes'],
      ['tag', 'from'],
      ['property', 'a'],
      ['number', '0'],
      ['number', '50%'],
      ['property', 'a'],
      ['number', '1turn'],
    ]);
  });

  it('classifies a container query and a `@supports` condition', () => {
    deepStrictEqual(spans('@container card (width > 40em) {}\n@supports not (display: grid) {}'), [
      ['keyword', '@container'],
      ['number', '40em'],
      ['keyword', '@supports'],
      ['keyword', 'not'],
      ['property', 'display'],
    ]);
  });

  it('tells a nested selector from a declaration', () => {
    deepStrictEqual(spans('.a { color: red; &:hover { color: blue } li { b: c } }'), [
      ['attribute', '.a'],
      ['property', 'color'],
      ['type', 'hover'],
      ['property', 'color'],
      ['tag', 'li'],
      ['property', 'b'],
    ]);
  });

  it('reads a minified pseudo-class selector against a minified declaration', () => {
    deepStrictEqual(spans('a:hover{color:red}'), [
      ['tag', 'a'],
      ['type', 'hover'],
      ['property', 'color'],
    ]);
  });

  it('classifies an attribute selector', () => {
    deepStrictEqual(spans('input[ type=text ], a[href^="http" i] {}'), [
      ['tag', 'input'],
      ['attribute', 'type'],
      ['string', 'text'],
      ['tag', 'a'],
      ['attribute', 'href'],
      ['string', '"http"'],
    ]);
  });

  it('keeps pseudo-class arguments', () => {
    deepStrictEqual(spans('li:nth-child(2n+1):not(.x) {}'), [
      ['tag', 'li'],
      ['type', 'nth-child'],
      ['number', '2n'],
      ['number', '+1'],
      ['type', 'not'],
      ['attribute', '.x'],
    ]);
  });

  it('keeps an escaped class name whole', () => {
    deepStrictEqual(spans('.sm\\:p-4 {}'), [['attribute', '.sm\\:p-4']]);
  });

  it('ignores a brace inside a string or comment', () => {
    deepStrictEqual(spans('a { content: "{"; /* { */ b: 1 }'), [
      ['tag', 'a'],
      ['property', 'content'],
      ['string', '"{"'],
      ['comment', '/* { */'],
      ['property', 'b'],
      ['number', '1'],
    ]);
  });

  it('reads bare declarations as an inline style', () => {
    deepStrictEqual(spans('color: red; -webkit-box-flex: 1'), [
      ['property', 'color'],
      ['property', '-webkit-box-flex'],
      ['number', '1'],
    ]);
  });

  it('ends an unterminated string at its line', () => {
    deepStrictEqual(spans('a { b: "open\n; c: 1 }'), [
      ['tag', 'a'],
      ['property', 'b'],
      ['string', '"open'],
      ['property', 'c'],
      ['number', '1'],
    ]);
  });

  it('runs an unterminated comment to the end', () => {
    deepStrictEqual(spans('a { /* open\n b: 1 }'), [
      ['tag', 'a'],
      ['comment', '/* open\n b: 1 }'],
    ]);
  });

  it('starts every call outside any statement', () => {
    tokenizeCSS('a { b: ');
    deepStrictEqual(spans('a {}'), [['tag', 'a']]);
  });

  it('emits sorted, non-empty tokens within bounds', () => {
    const code = `@media (a: 1) { .x[y="z"] { --c: url(d) #e !important } }\n/* f`;
    let last = 0;
    for (const token of tokenizeCSS(code)) {
      ok(token.start >= last && token.end > token.start && token.end <= code.length);
      last = token.end;
    }
  });

  it('stays linear on adversarial input', () => {
    const inputs = [
      '{'.repeat(1 << 20),
      '"'.repeat(1 << 20),
      '"a'.repeat(1 << 19),
      '/*'.repeat(1 << 19),
      'a:'.repeat(1 << 19),
      'url('.repeat(1 << 18),
      'url(a;{'.repeat(1 << 17),
      '[a='.repeat(1 << 18),
      '\\'.repeat(1 << 20),
      '!' + ' '.repeat(1 << 20),
      '1.'.repeat(1 << 19),
      '/a'.repeat(1 << 19),
    ];
    for (const input of inputs) {
      const start = performance.now();
      tokenizeCSS(input);
      ok(performance.now() - start < 1000, input.slice(0, 8));
    }
  });
});
