import { deepStrictEqual, strictEqual, throws } from 'node:assert';
import { describe, it } from 'node:test';

import type { PluralNode, SelectNode } from '../../../src/utils/i18n/ast.ts';

import { MessageSyntaxError } from '../../../src/utils/i18n/errors.ts';
import { parse } from '../../../src/utils/i18n/parse.ts';

describe('parse - literals and escapes', () => {
  it('returns an empty AST for an empty template', () => {
    deepStrictEqual(parse(''), []);
  });

  it('returns a single literal node for plain text', () => {
    deepStrictEqual(parse('hello world'), [{ kind: 'literal', value: 'hello world' }]);
  });

  it("renders `''` as a single literal apostrophe", () => {
    deepStrictEqual(parse("it''s"), [{ kind: 'literal', value: "it's" }]);
  });

  it("treats a lone `'` before non-syntax text as a literal apostrophe", () => {
    deepStrictEqual(parse("don't"), [{ kind: 'literal', value: "don't" }]);
  });

  it("opens a quoted region when `'` immediately precedes `{`", () => {
    deepStrictEqual(parse("'{escaped}'"), [{ kind: 'literal', value: '{escaped}' }]);
  });

  it("opens a quoted region when `'` immediately precedes `}`", () => {
    deepStrictEqual(parse("'}'"), [{ kind: 'literal', value: '}' }]);
  });

  it("treats `'#` outside a plural body as a literal `'#` (no quote opens)", () => {
    deepStrictEqual(parse("'#"), [{ kind: 'literal', value: "'#" }]);
  });

  it('runs an unterminated quote to end of template (ICU-lenient)', () => {
    deepStrictEqual(parse("unterminated '{quoted text"), [
      { kind: 'literal', value: 'unterminated {quoted text' },
    ]);
  });

  it("preserves `''` inside a quoted region as a literal `'`", () => {
    deepStrictEqual(parse("'{a''b}'"), [{ kind: 'literal', value: "{a'b}" }]);
  });

  it("`'''{x}'''` renders an apostrophe, then placeholder text, then apostrophe", () => {
    deepStrictEqual(parse("'''{x}'''"), [{ kind: 'literal', value: "'{x}'" }]);
  });
});

describe('parse - simple arguments', () => {
  it('parses `{name}` into an argument node', () => {
    deepStrictEqual(parse('{name}'), [{ kind: 'argument', name: 'name' }]);
  });

  it('tolerates whitespace around the argument name', () => {
    deepStrictEqual(parse('{  name  }'), [{ kind: 'argument', name: 'name' }]);
  });

  it('keeps numeric (positional) names as strings', () => {
    deepStrictEqual(parse('{0} and {1}'), [
      { kind: 'argument', name: '0' },
      { kind: 'literal', value: ' and ' },
      { kind: 'argument', name: '1' },
    ]);
  });

  it('interleaves literals and arguments', () => {
    deepStrictEqual(parse('Hello, {name}!'), [
      { kind: 'literal', value: 'Hello, ' },
      { kind: 'argument', name: 'name' },
      { kind: 'literal', value: '!' },
    ]);
  });

  it('throws on an empty argument', () => {
    throws(() => parse('{}'), MessageSyntaxError);
  });

  it('throws on an unclosed argument', () => {
    throws(() => parse('Hello {name'), MessageSyntaxError);
  });

  it('throws on a stray closing brace at the top level', () => {
    throws(() => parse('Hello }'), MessageSyntaxError);
  });

  it('attaches position info to syntax errors', () => {
    try {
      parse('Hello }');
    } catch (e) {
      strictEqual(e instanceof MessageSyntaxError, true);
      const err = e as MessageSyntaxError;
      strictEqual(err.position, 6);
      strictEqual(err.line, 1);
      strictEqual(err.column, 7);
      return;
    }
    throw new Error('expected throw');
  });
});

describe('parse - number / date / time', () => {
  it('parses `{n, number}` with null style', () => {
    deepStrictEqual(parse('{n, number}'), [{ kind: 'number', name: 'n', style: null }]);
  });

  it('parses predefined number styles', () => {
    deepStrictEqual(parse('{n, number, integer}'), [
      { kind: 'number', name: 'n', style: 'integer' },
    ]);
    deepStrictEqual(parse('{n, number, percent}'), [
      { kind: 'number', name: 'n', style: 'percent' },
    ]);
    deepStrictEqual(parse('{n, number, currency}'), [
      { kind: 'number', name: 'n', style: 'currency' },
    ]);
  });

  it('preserves a raw skeleton string in the style field', () => {
    deepStrictEqual(parse('{n, number, ::currency/EUR .00}'), [
      { kind: 'number', name: 'n', style: '::currency/EUR .00' },
    ]);
  });

  it('parses `{d, date}` and `{d, date, short}`', () => {
    deepStrictEqual(parse('{d, date}'), [{ kind: 'date', name: 'd', style: null }]);
    deepStrictEqual(parse('{d, date, short}'), [{ kind: 'date', name: 'd', style: 'short' }]);
  });

  it('parses `{d, time, medium}`', () => {
    deepStrictEqual(parse('{d, time, medium}'), [{ kind: 'time', name: 'd', style: 'medium' }]);
  });

  it('trims surrounding whitespace from the style', () => {
    deepStrictEqual(parse('{n, number,   integer   }'), [
      { kind: 'number', name: 'n', style: 'integer' },
    ]);
  });

  it('handles `{` and `}` inside a style via balanced nesting', () => {
    deepStrictEqual(parse('{d, date, {year}}'), [{ kind: 'date', name: 'd', style: '{year}' }]);
  });
});

describe('parse - plural', () => {
  it('parses a minimal plural', () => {
    deepStrictEqual(parse('{n, plural, one {a} other {b}}'), [
      {
        kind: 'plural',
        name: 'n',
        ordinal: false,
        offset: 0,
        cases: [
          { keyword: 'one', exact: null, body: [{ kind: 'literal', value: 'a' }] },
          { keyword: 'other', exact: null, body: [{ kind: 'literal', value: 'b' }] },
        ],
      },
    ]);
  });

  it('parses an exact `=N` selector', () => {
    deepStrictEqual(parse('{n, plural, =0 {none} other {many}}'), [
      {
        kind: 'plural',
        name: 'n',
        ordinal: false,
        offset: 0,
        cases: [
          { keyword: '=0', exact: 0, body: [{ kind: 'literal', value: 'none' }] },
          { keyword: 'other', exact: null, body: [{ kind: 'literal', value: 'many' }] },
        ],
      },
    ]);
  });

  it('parses a negative `=N`', () => {
    const ast = parse('{n, plural, =-1 {neg} other {x}}');
    const node = ast[0] as PluralNode;
    strictEqual(node.kind, 'plural');
    strictEqual(node.cases[0]!.keyword, '=-1');
    strictEqual(node.cases[0]!.exact, -1);
  });

  it('parses `offset:N` (positive)', () => {
    const ast = parse('{n, plural, offset:1 one {x} other {y}}');
    strictEqual((ast[0] as PluralNode).offset, 1);
  });

  it('parses `offset:0` explicitly', () => {
    const ast = parse('{n, plural, offset:0 other {x}}');
    strictEqual((ast[0] as PluralNode).offset, 0);
  });

  it('parses negative `offset:N`', () => {
    const ast = parse('{n, plural, offset:-2 other {x}}');
    strictEqual((ast[0] as PluralNode).offset, -2);
  });

  it('throws when `offset:` is not followed by an integer', () => {
    throws(() => parse('{n, plural, offset: one {x} other {y}}'), MessageSyntaxError);
    throws(() => parse('{n, plural, offset:- other {y}}'), MessageSyntaxError);
  });

  it('throws when the `other` case is missing', () => {
    throws(() => parse('{n, plural, one {x}}'), MessageSyntaxError);
  });

  it('parses `selectordinal` with the ordinal flag set', () => {
    const ast = parse('{n, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}');
    strictEqual((ast[0] as { ordinal: boolean }).ordinal, true);
  });

  it('throws when selectordinal has no `other`', () => {
    throws(() => parse('{n, selectordinal, one {x}}'), MessageSyntaxError);
  });

  it('records `#` as a `pound` node inside a plural body', () => {
    deepStrictEqual(parse('{n, plural, other {# items}}'), [
      {
        kind: 'plural',
        name: 'n',
        ordinal: false,
        offset: 0,
        cases: [
          {
            keyword: 'other',
            exact: null,
            body: [{ kind: 'pound' }, { kind: 'literal', value: ' items' }],
          },
        ],
      },
    ]);
  });

  it("treats `'#'` inside a plural body as a literal `#`", () => {
    deepStrictEqual(parse("{n, plural, other {'#'}}"), [
      {
        kind: 'plural',
        name: 'n',
        ordinal: false,
        offset: 0,
        cases: [{ keyword: 'other', exact: null, body: [{ kind: 'literal', value: '#' }] }],
      },
    ]);
  });

  it('tolerates ample whitespace inside a plural', () => {
    const compact = parse('{n,plural,one{x}other{y}}');
    const padded = parse('{ n , plural , one {x} other {y} }');
    deepStrictEqual(compact, padded);
  });
});

describe('parse - select', () => {
  it('parses a minimal select', () => {
    deepStrictEqual(parse('{g, select, male {he} female {she} other {they}}'), [
      {
        kind: 'select',
        name: 'g',
        cases: [
          { keyword: 'male', body: [{ kind: 'literal', value: 'he' }] },
          { keyword: 'female', body: [{ kind: 'literal', value: 'she' }] },
          { keyword: 'other', body: [{ kind: 'literal', value: 'they' }] },
        ],
      },
    ]);
  });

  it('throws when the `other` case is missing', () => {
    throws(() => parse('{g, select, male {he}}'), MessageSyntaxError);
  });

  it('treats `#` inside a select body as a literal `#` when not in a plural', () => {
    deepStrictEqual(parse('{g, select, m {#a} other {#b}}'), [
      {
        kind: 'select',
        name: 'g',
        cases: [
          { keyword: 'm', body: [{ kind: 'literal', value: '#a' }] },
          { keyword: 'other', body: [{ kind: 'literal', value: '#b' }] },
        ],
      },
    ]);
  });
});

describe('parse - nesting and `#` binding', () => {
  it('binds `#` inside a select-inside-plural to the outer plural', () => {
    const ast = parse(
      '{count, plural, other {{gender, select, female {she has #} other {they have #}}}}',
    );
    const outer = ast[0] as PluralNode;
    strictEqual(outer.kind, 'plural');
    const selectNode = outer.cases[0]!.body[0] as SelectNode;
    strictEqual(selectNode.kind, 'select');
    const sheBranch = selectNode.cases[0]!.body;
    strictEqual(
      sheBranch.some((n) => n.kind === 'pound'),
      true,
    );
  });

  it('rebinds `#` to the innermost plural', () => {
    const ast = parse('{a, plural, other {{b, plural, other {#}}}}');
    const outer = ast[0] as PluralNode;
    strictEqual(outer.kind, 'plural');
    const inner = outer.cases[0]!.body[0] as PluralNode;
    strictEqual(inner.kind, 'plural');
    strictEqual(inner.cases[0]!.body[0]!.kind, 'pound');
  });

  it('parses a simple argument inside a select body', () => {
    deepStrictEqual(parse('{role, select, admin {Welcome, {name}!} other {Hi}}'), [
      {
        kind: 'select',
        name: 'role',
        cases: [
          {
            keyword: 'admin',
            body: [
              { kind: 'literal', value: 'Welcome, ' },
              { kind: 'argument', name: 'name' },
              { kind: 'literal', value: '!' },
            ],
          },
          { keyword: 'other', body: [{ kind: 'literal', value: 'Hi' }] },
        ],
      },
    ]);
  });
});

describe('parse - rejected argument types', () => {
  it('rejects `choice` at parse time', () => {
    throws(() => parse('{n, choice, 0#none|1#one|1<many}'), /choice/);
  });

  it('rejects `spellout`', () => {
    throws(() => parse('{n, spellout}'), /spellout/);
  });

  it('rejects `duration`', () => {
    throws(() => parse('{n, duration}'), /duration/);
  });

  it('rejects standalone `ordinal`', () => {
    throws(() => parse('{n, ordinal}'), /ordinal/);
  });

  it('rejects unknown types', () => {
    throws(() => parse('{n, frobnicate}'), /unknown argument type/);
  });
});

describe('parse - error positions', () => {
  it('points at the stray `}`', () => {
    try {
      parse('abc}xyz');
    } catch (e) {
      strictEqual((e as MessageSyntaxError).position, 3);
      return;
    }
    throw new Error('expected throw');
  });

  it('points at the type token when rejecting `choice`', () => {
    try {
      parse('hello {n, choice, 0#a|1<b}');
    } catch (e) {
      const err = e as MessageSyntaxError;
      strictEqual(err.position, 'hello {n, '.length);
      return;
    }
    throw new Error('expected throw');
  });

  it('reports the missing-`other` error pointing at the comma after the plural type', () => {
    try {
      parse('{n, plural, one {x}}');
    } catch (e) {
      strictEqual(e instanceof MessageSyntaxError, true);
      strictEqual((e as MessageSyntaxError).position, '{n, plural'.length);
      strictEqual((e as MessageSyntaxError).message.includes('other'), true);
      return;
    }
    throw new Error('expected throw');
  });

  it('reports a useful error for an empty argument', () => {
    try {
      parse('{}');
    } catch (e) {
      strictEqual((e as MessageSyntaxError).message.includes('expected argument name'), true);
      return;
    }
    throw new Error('expected throw');
  });
});
