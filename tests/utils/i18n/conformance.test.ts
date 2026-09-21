import { strictEqual, throws } from 'node:assert';
import { describe, it } from 'node:test';

import { formatMessage } from '../../../src/utils/i18n/format-message.ts';

type Case = {
  name: string;
  template: string;
  params?: Record<string, unknown>;
  language?: string;
  expected: string;
};

const CASES: readonly Case[] = [
  {
    name: 'simple argument',
    template: 'Hello, {name}!',
    params: { name: 'world' },
    expected: 'Hello, world!',
  },
  {
    name: 'positional arguments',
    template: '{0} and {1}',
    params: { 0: 'a', 1: 'b' },
    expected: 'a and b',
  },
  {
    name: 'repeated argument',
    template: '{a} {a} {b}',
    params: { a: 'x', b: 'y' },
    expected: 'x x y',
  },

  { name: 'quoted braces', template: "'{escaped}'", expected: '{escaped}' },
  { name: 'doubled apostrophe -> literal', template: "it''s", expected: "it's" },
  { name: 'lone apostrophe before non-syntax', template: "don't", expected: "don't" },
  { name: 'quoted opening brace only', template: "'{", expected: '{' },
  { name: 'quoted closing brace only', template: "'}", expected: '}' },
  { name: 'mixed escapes', template: "'{'a'}'", expected: '{a}' },
  {
    name: "''{x}'' renders literal apostrophes around a placeholder",
    template: "''{x}''",
    params: { x: 'Y' },
    expected: "'Y'",
  },
  {
    name: "'''{x}''' escapes the placeholder inside a quoted span",
    template: "'''{x}'''",
    params: { x: 'Y' },
    expected: "'{x}'",
  },

  {
    name: 'number with grouping (en-US)',
    template: '{n, number}',
    params: { n: 1234.5 },
    language: 'en-US',
    expected: '1,234.5',
  },
  {
    name: 'number integer style',
    template: '{n, number, integer}',
    params: { n: 1234.6 },
    language: 'en-US',
    expected: '1,235',
  },
  {
    name: 'number percent style',
    template: '{n, number, percent}',
    params: { n: 0.42 },
    language: 'en-US',
    expected: '42%',
  },

  {
    name: 'select female branch',
    template: '{g, select, female {she} male {he} other {they}}',
    params: { g: 'female' },
    expected: 'she',
  },
  {
    name: 'select falls through to other',
    template: '{g, select, female {she} male {he} other {they}}',
    params: { g: 'xx' },
    expected: 'they',
  },

  {
    name: 'plural one (en)',
    template: '{n, plural, one {# apple} other {# apples}}',
    params: { n: 1 },
    language: 'en-US',
    expected: '1 apple',
  },
  {
    name: 'plural other (en)',
    template: '{n, plural, one {# apple} other {# apples}}',
    params: { n: 2 },
    language: 'en-US',
    expected: '2 apples',
  },
  {
    name: 'plural =0 wins over keyword',
    template: '{n, plural, =0 {none} one {# apple} other {# apples}}',
    params: { n: 0 },
    language: 'en-US',
    expected: 'none',
  },
  {
    name: 'plural =1 wins over keyword',
    template: '{n, plural, =1 {just one} one {# apple} other {# apples}}',
    params: { n: 1 },
    language: 'en-US',
    expected: 'just one',
  },

  {
    name: 'plural offset: pre-offset =1 wins',
    template: '{n, plural, offset:1 =0 {none} =1 {just you} one {you and #} other {you and #}}',
    params: { n: 1 },
    language: 'en-US',
    expected: 'just you',
  },
  {
    name: 'plural offset: # uses (n - offset)',
    template: '{n, plural, offset:1 =0 {none} =1 {just you} one {you and #} other {you and #}}',
    params: { n: 2 },
    language: 'en-US',
    expected: 'you and 1',
  },
  {
    name: 'plural offset: # alone',
    template: '{n, plural, offset:1 other {#}}',
    params: { n: 5 },
    language: 'en-US',
    expected: '4',
  },
  {
    name: 'plural offset of 2 with #',
    template: '{n, plural, offset:2 other {#}}',
    params: { n: 5 },
    language: 'en-US',
    expected: '3',
  },

  {
    name: 'plural escaped # is literal',
    template: "{n, plural, other {'#'}}",
    params: { n: 7 },
    expected: '#',
  },
  {
    name: 'plural # then quoted text',
    template: "{n, plural, other {#'#1'}}",
    params: { n: 7 },
    language: 'en-US',
    expected: '7#1',
  },
  {
    name: 'plural escaped opening brace',
    template: "{n, plural, other {'{'}}",
    params: { n: 1 },
    expected: '{',
  },

  {
    name: 'selectordinal 1 -> 1st (en)',
    template: '{n, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}',
    params: { n: 1 },
    language: 'en-US',
    expected: '1st',
  },
  {
    name: 'selectordinal 23 -> 23rd (en)',
    template: '{n, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}',
    params: { n: 23 },
    language: 'en-US',
    expected: '23rd',
  },

  {
    name: '# inside select inside plural binds to outer',
    template: '{c, plural, other {{g, select, f {she has #} other {they have #}}}}',
    params: { c: 5, g: 'f' },
    language: 'en-US',
    expected: 'she has 5',
  },
  {
    name: '# inside select inside plural respects offset',
    template:
      '{c, plural, offset:1 other {{g, select, f {she has # extra} other {they have # extra}}}}',
    params: { c: 5, g: 'f' },
    language: 'en-US',
    expected: 'she has 4 extra',
  },
  {
    name: '# rebinds to innermost plural',
    template: '{c, plural, other {{n, plural, other {#}}}}',
    params: { c: 5, n: 2 },
    language: 'en-US',
    expected: '2',
  },

  {
    name: 'whitespace tolerated between tokens',
    template: '{ n , plural , offset:1 one {x} other {y} }',
    params: { n: 2 },
    language: 'en-US',
    expected: 'x',
  },
  {
    name: 'no whitespace at all',
    template: '{n,plural,one{x}other{y}}',
    params: { n: 2 },
    language: 'en-US',
    expected: 'y',
  },

  {
    name: 'whitespace around =N selector',
    template: '{n, plural, =1 {a} other {b}}',
    params: { n: 1 },
    language: 'en-US',
    expected: 'a',
  },

  {
    name: 'apostrophe before non-syntax (s) is literal',
    template: "{who}'s book",
    params: { who: 'Jaina' },
    expected: "Jaina's book",
  },
  {
    name: 'apostrophe before { opens a literal span',
    template: "{who}'{book}'",
    params: { who: 'A', book: 'B' },
    expected: 'A{book}',
  },
  {
    name: 'unterminated quote runs to EOF (lenient)',
    template: "unterminated '{quote",
    expected: 'unterminated {quote',
  },
  {
    name: "lone ' before non-syntax char (DOUBLE_OPTIONAL) is literal",
    template: "unterminated 'quote",
    expected: "unterminated 'quote",
  },

  {
    name: 'pl plural one',
    template: '{n, plural, one {one} few {few} many {many} other {other}}',
    params: { n: 1 },
    language: 'pl',
    expected: 'one',
  },
  {
    name: 'pl plural few',
    template: '{n, plural, one {one} few {few} many {many} other {other}}',
    params: { n: 2 },
    language: 'pl',
    expected: 'few',
  },
  {
    name: 'pl plural many',
    template: '{n, plural, one {one} few {few} many {many} other {other}}',
    params: { n: 5 },
    language: 'pl',
    expected: 'many',
  },

  {
    name: 'deeply nested select inside select',
    template: '{a, select, x {{b, select, y {deep} other {shallow}}} other {none}}',
    params: { a: 'x', b: 'y' },
    expected: 'deep',
  },

  {
    name: 'currency skeleton (en-US)',
    template: '{n, number, ::currency/EUR}',
    params: { n: 9.5 },
    language: 'en-US',
    expected: '€9.50',
  },
];

describe('conformance - ICU MessageFormat v1 corpus', () => {
  for (const c of CASES) {
    it(c.name, () => {
      strictEqual(formatMessage(c.template, c.params, c.language ?? 'en-US'), c.expected);
    });
  }
});

describe('conformance - parse-time rejections', () => {
  it('rejects plural with no other', () => {
    throws(() => formatMessage('{n, plural, one {x}}', { n: 1 }, 'en'), /other/);
  });

  it('rejects selectordinal with no other', () => {
    throws(() => formatMessage('{n, selectordinal, one {x}}', { n: 1 }, 'en'), /other/);
  });

  it('rejects select with no other', () => {
    throws(() => formatMessage('{g, select, x {y}}', { g: 'x' }, 'en'), /other/);
  });

  it('rejects plural with offset and no other', () => {
    throws(() => formatMessage('{n, plural, offset:1 =5 {five}}', { n: 5 }, 'en'), /other/);
  });

  it('rejects choice format', () => {
    throws(
      () => formatMessage('{n, choice, 0#none|1#one|1<{n,number} files}', { n: 5 }, 'en'),
      /choice/,
    );
  });

  it('rejects spellout', () => {
    throws(() => formatMessage('{n, spellout}', { n: 5 }, 'en'), /spellout/);
  });

  it('rejects duration', () => {
    throws(() => formatMessage('{n, duration}', { n: 5 }, 'en'), /duration/);
  });

  it('rejects standalone ordinal', () => {
    throws(() => formatMessage('{n, ordinal}', { n: 5 }, 'en'), /ordinal/);
  });
});
