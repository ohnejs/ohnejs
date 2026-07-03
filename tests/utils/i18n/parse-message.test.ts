import { deepStrictEqual, strictEqual, throws } from 'node:assert';
import { describe, it } from 'node:test';

import type { MessagePluralNode, MessageSelectNode } from '../../../src/utils/i18n/message-ast.ts';

import { MessageSyntaxError } from '../../../src/utils/i18n/message-errors.ts';
import { parseMessage } from '../../../src/utils/i18n/parse-message.ts';

describe('parseMessage - literals and escapes', () => {
  it('returns an empty AST for an empty template', () => {
    deepStrictEqual(parseMessage(''), []);
  });

  it('returns a single literal node for plain text', () => {
    deepStrictEqual(parseMessage('hello world'), [{ kind: 'literal', value: 'hello world' }]);
  });

  it("renders `''` as a single literal apostrophe", () => {
    deepStrictEqual(parseMessage("it''s"), [{ kind: 'literal', value: "it's" }]);
  });

  it("treats a lone `'` before non-syntax text as a literal apostrophe", () => {
    deepStrictEqual(parseMessage("don't"), [{ kind: 'literal', value: "don't" }]);
  });

  it("opens a quoted region when `'` immediately precedes `{`", () => {
    deepStrictEqual(parseMessage("'{escaped}'"), [{ kind: 'literal', value: '{escaped}' }]);
  });

  it("opens a quoted region when `'` immediately precedes `}`", () => {
    deepStrictEqual(parseMessage("'}'"), [{ kind: 'literal', value: '}' }]);
  });

  it("treats `'#` outside a plural body as a literal `'#` (no quote opens)", () => {
    deepStrictEqual(parseMessage("'#"), [{ kind: 'literal', value: "'#" }]);
  });

  it('runs an unterminated quote to end of template (ICU-lenient)', () => {
    deepStrictEqual(parseMessage("unterminated '{quoted text"), [
      { kind: 'literal', value: 'unterminated {quoted text' },
    ]);
  });

  it("preserves `''` inside a quoted region as a literal `'`", () => {
    deepStrictEqual(parseMessage("'{a''b}'"), [{ kind: 'literal', value: "{a'b}" }]);
  });

  it("`'''{x}'''` renders an apostrophe, then placeholder text, then apostrophe", () => {
    deepStrictEqual(parseMessage("'''{x}'''"), [{ kind: 'literal', value: "'{x}'" }]);
  });
});

describe('parseMessage - simple arguments', () => {
  it('parses `{name}` into an argument node', () => {
    deepStrictEqual(parseMessage('{name}'), [{ kind: 'argument', name: 'name' }]);
  });

  it('tolerates whitespace around the argument name', () => {
    deepStrictEqual(parseMessage('{  name  }'), [{ kind: 'argument', name: 'name' }]);
  });

  it('keeps numeric (positional) names as strings', () => {
    deepStrictEqual(parseMessage('{0} and {1}'), [
      { kind: 'argument', name: '0' },
      { kind: 'literal', value: ' and ' },
      { kind: 'argument', name: '1' },
    ]);
  });

  it('interleaves literals and arguments', () => {
    deepStrictEqual(parseMessage('Hello, {name}!'), [
      { kind: 'literal', value: 'Hello, ' },
      { kind: 'argument', name: 'name' },
      { kind: 'literal', value: '!' },
    ]);
  });

  it('throws on an empty argument', () => {
    throws(() => parseMessage('{}'), MessageSyntaxError);
  });

  it('throws on an unclosed argument', () => {
    throws(() => parseMessage('Hello {name'), MessageSyntaxError);
  });

  it('throws on a stray closing brace at the top level', () => {
    throws(() => parseMessage('Hello }'), MessageSyntaxError);
  });

  it('attaches position info to syntax errors', () => {
    try {
      parseMessage('Hello }');
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

describe('parseMessage - number / date / time', () => {
  it('parses `{n, number}` with null style', () => {
    deepStrictEqual(parseMessage('{n, number}'), [{ kind: 'number', name: 'n', style: null }]);
  });

  it('parses predefined number styles', () => {
    deepStrictEqual(parseMessage('{n, number, integer}'), [
      { kind: 'number', name: 'n', style: 'integer' },
    ]);
    deepStrictEqual(parseMessage('{n, number, percent}'), [
      { kind: 'number', name: 'n', style: 'percent' },
    ]);
    deepStrictEqual(parseMessage('{n, number, currency}'), [
      { kind: 'number', name: 'n', style: 'currency' },
    ]);
  });

  it('preserves a raw skeleton string in the style field', () => {
    deepStrictEqual(parseMessage('{n, number, ::currency/EUR .00}'), [
      { kind: 'number', name: 'n', style: '::currency/EUR .00' },
    ]);
  });

  it('parses `{d, date}` and `{d, date, short}`', () => {
    deepStrictEqual(parseMessage('{d, date}'), [{ kind: 'date', name: 'd', style: null }]);
    deepStrictEqual(parseMessage('{d, date, short}'), [
      { kind: 'date', name: 'd', style: 'short' },
    ]);
  });

  it('parses `{d, time, medium}`', () => {
    deepStrictEqual(parseMessage('{d, time, medium}'), [
      { kind: 'time', name: 'd', style: 'medium' },
    ]);
  });

  it('trims surrounding whitespace from the style', () => {
    deepStrictEqual(parseMessage('{n, number,   integer   }'), [
      { kind: 'number', name: 'n', style: 'integer' },
    ]);
  });

  it('handles `{` and `}` inside a style via balanced nesting', () => {
    deepStrictEqual(parseMessage('{d, date, {year}}'), [
      { kind: 'date', name: 'd', style: '{year}' },
    ]);
  });

  it("treats a lone `'` inside argStyle as a literal under DOUBLE_OPTIONAL", () => {
    deepStrictEqual(parseMessage("{x, number, can't}"), [
      { kind: 'number', name: 'x', style: "can't" },
    ]);
  });

  it("treats a lone `'` inside a nested-brace argStyle as a literal", () => {
    deepStrictEqual(parseMessage("{d, date, {can't}}"), [
      { kind: 'date', name: 'd', style: "{can't}" },
    ]);
  });

  it("still opens a literal span on `'` before `{` inside argStyle", () => {
    deepStrictEqual(parseMessage("{d, date, '{lit}'}"), [
      { kind: 'date', name: 'd', style: "'{lit}'" },
    ]);
  });
});

describe('parseMessage - plural', () => {
  it('parses a minimal plural', () => {
    deepStrictEqual(parseMessage('{n, plural, one {a} other {b}}'), [
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
    deepStrictEqual(parseMessage('{n, plural, =0 {none} other {many}}'), [
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
    const ast = parseMessage('{n, plural, =-1 {neg} other {x}}');
    const node = ast[0] as MessagePluralNode;
    strictEqual(node.kind, 'plural');
    strictEqual(node.cases[0]!.keyword, '=-1');
    strictEqual(node.cases[0]!.exact, -1);
  });

  it('parses `offset:N` (positive)', () => {
    const ast = parseMessage('{n, plural, offset:1 one {x} other {y}}');
    strictEqual((ast[0] as MessagePluralNode).offset, 1);
  });

  it('parses `offset:0` explicitly', () => {
    const ast = parseMessage('{n, plural, offset:0 other {x}}');
    strictEqual((ast[0] as MessagePluralNode).offset, 0);
  });

  it('parses negative `offset:N`', () => {
    const ast = parseMessage('{n, plural, offset:-2 other {x}}');
    strictEqual((ast[0] as MessagePluralNode).offset, -2);
  });

  it('allows whitespace between `offset:` and its value', () => {
    const ast = parseMessage('{n, plural, offset: 1 one {x} other {y}}');
    strictEqual((ast[0] as MessagePluralNode).offset, 1);
  });

  it('parses a decimal `offset:N`', () => {
    const ast = parseMessage('{n, plural, offset:1.5 other {x}}');
    strictEqual((ast[0] as MessagePluralNode).offset, 1.5);
  });

  it('parses a decimal `=N` exact selector', () => {
    const ast = parseMessage('{n, plural, =1.5 {x} other {y}}');
    const node = ast[0] as MessagePluralNode;
    strictEqual(node.cases[0]!.keyword, '=1.5');
    strictEqual(node.cases[0]!.exact, 1.5);
  });

  it('throws when `offset:` is not followed by a number', () => {
    throws(() => parseMessage('{n, plural, offset: one {x} other {y}}'), MessageSyntaxError);
    throws(() => parseMessage('{n, plural, offset:- other {y}}'), MessageSyntaxError);
  });

  it('throws when the `other` case is missing', () => {
    throws(() => parseMessage('{n, plural, one {x}}'), MessageSyntaxError);
  });

  it('parses `selectordinal` with the ordinal flag set', () => {
    const ast = parseMessage('{n, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}');
    strictEqual((ast[0] as { ordinal: boolean }).ordinal, true);
  });

  it('throws when selectordinal has no `other`', () => {
    throws(() => parseMessage('{n, selectordinal, one {x}}'), MessageSyntaxError);
  });

  it('records `#` as a `pound` node inside a plural body', () => {
    deepStrictEqual(parseMessage('{n, plural, other {# items}}'), [
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
    deepStrictEqual(parseMessage("{n, plural, other {'#'}}"), [
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
    const compact = parseMessage('{n,plural,one{x}other{y}}');
    const padded = parseMessage('{ n , plural , one {x} other {y} }');
    deepStrictEqual(compact, padded);
  });
});

describe('parseMessage - select', () => {
  it('parses a minimal select', () => {
    deepStrictEqual(parseMessage('{g, select, male {he} female {she} other {they}}'), [
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
    throws(() => parseMessage('{g, select, male {he}}'), MessageSyntaxError);
  });

  it('treats `#` inside a select body as a literal `#` when not in a plural', () => {
    deepStrictEqual(parseMessage('{g, select, m {#a} other {#b}}'), [
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

describe('parseMessage - nesting and `#` binding', () => {
  it('binds `#` inside a select-inside-plural to the outer plural', () => {
    const ast = parseMessage(
      '{count, plural, other {{gender, select, female {she has #} other {they have #}}}}',
    );
    const outer = ast[0] as MessagePluralNode;
    strictEqual(outer.kind, 'plural');
    const selectNode = outer.cases[0]!.body[0] as MessageSelectNode;
    strictEqual(selectNode.kind, 'select');
    const sheBranch = selectNode.cases[0]!.body;
    strictEqual(
      sheBranch.some((n) => n.kind === 'pound'),
      true,
    );
  });

  it('rebinds `#` to the innermost plural', () => {
    const ast = parseMessage('{a, plural, other {{b, plural, other {#}}}}');
    const outer = ast[0] as MessagePluralNode;
    strictEqual(outer.kind, 'plural');
    const inner = outer.cases[0]!.body[0] as MessagePluralNode;
    strictEqual(inner.kind, 'plural');
    strictEqual(inner.cases[0]!.body[0]!.kind, 'pound');
  });

  it('parses a simple argument inside a select body', () => {
    deepStrictEqual(parseMessage('{role, select, admin {Welcome, {name}!} other {Hi}}'), [
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

describe('parseMessage - rejected argument types', () => {
  it('rejects `choice` at parse time', () => {
    throws(() => parseMessage('{n, choice, 0#none|1#one|1<many}'), /choice/);
  });

  it('rejects `spellout`', () => {
    throws(() => parseMessage('{n, spellout}'), /spellout/);
  });

  it('rejects `duration`', () => {
    throws(() => parseMessage('{n, duration}'), /duration/);
  });

  it('rejects standalone `ordinal`', () => {
    throws(() => parseMessage('{n, ordinal}'), /ordinal/);
  });

  it('rejects unknown types', () => {
    throws(() => parseMessage('{n, frobnicate}'), /unknown argument type/);
  });
});

describe('parseMessage - error positions', () => {
  it('points at the stray `}`', () => {
    try {
      parseMessage('abc}xyz');
    } catch (e) {
      strictEqual((e as MessageSyntaxError).position, 3);
      return;
    }
    throw new Error('expected throw');
  });

  it('points at the type token when rejecting `choice`', () => {
    try {
      parseMessage('hello {n, choice, 0#a|1<b}');
    } catch (e) {
      const err = e as MessageSyntaxError;
      strictEqual(err.position, 'hello {n, '.length);
      return;
    }
    throw new Error('expected throw');
  });

  it('reports the missing-`other` error pointing at the comma after the plural type', () => {
    try {
      parseMessage('{n, plural, one {x}}');
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
      parseMessage('{}');
    } catch (e) {
      strictEqual((e as MessageSyntaxError).message.includes('expected argument name'), true);
      return;
    }
    throw new Error('expected throw');
  });
});
