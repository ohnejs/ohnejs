import { deepStrictEqual, ok } from 'node:assert';
import { describe, it } from 'node:test';

import { tokenizeSQL } from '../../../../src/utils/highlight/languages/sql.ts';

const spans = (code: string) => tokenizeSQL(code).map((t) => [t.kind, code.slice(t.start, t.end)]);

describe('tokenizeSQL', () => {
  it('matches its example', () => {
    deepStrictEqual(tokenizeSQL('select count(*) from t where id = $1'), [
      { kind: 'keyword', start: 0, end: 6 },
      { kind: 'function', start: 7, end: 12 },
      { kind: 'keyword', start: 16, end: 20 },
      { kind: 'keyword', start: 23, end: 28 },
      { kind: 'variable', start: 34, end: 36 },
    ]);
  });

  it('classifies keywords in any case', () => {
    deepStrictEqual(spans('SELECT a FrOm b left join c on true'), [
      ['keyword', 'SELECT'],
      ['keyword', 'FrOm'],
      ['keyword', 'left'],
      ['keyword', 'join'],
      ['keyword', 'on'],
      ['keyword', 'true'],
    ]);
  });

  it('classifies `NULL`, `TRUE` and `FALSE` as keywords', () => {
    deepStrictEqual(spans('null, True, FALSE'), [
      ['keyword', 'null'],
      ['keyword', 'True'],
      ['keyword', 'FALSE'],
    ]);
  });

  it('classifies line and block comments', () => {
    deepStrictEqual(spans('-- a\nselect /* b */ 1'), [
      ['comment', '-- a'],
      ['keyword', 'select'],
      ['comment', '/* b */'],
      ['number', '1'],
    ]);
  });

  it('keeps a doubled quote inside its string', () => {
    deepStrictEqual(spans("'it''s' ''"), [
      ['string', "'it''s'"],
      ['string', "''"],
    ]);
  });

  it('classifies prefixed strings', () => {
    deepStrictEqual(spans("E'a' N'b' X'ff'"), [
      ['string', "E'a'"],
      ['string', "N'b'"],
      ['string', "X'ff'"],
    ]);
  });

  it('classifies a dollar-quoted body as one string', () => {
    deepStrictEqual(spans("$$ it's $$ $fn$ a $$ b $fn$ 1"), [
      ['string', "$$ it's $$"],
      ['string', '$fn$ a $$ b $fn$'],
      ['number', '1'],
    ]);
  });

  it('classifies quoted identifiers as properties', () => {
    deepStrictEqual(spans('"user ""x""" `order` ```a`'), [
      ['property', '"user ""x"""'],
      ['property', '`order`'],
      ['property', '```a`'],
    ]);
  });

  it('classifies a qualified column as a property', () => {
    deepStrictEqual(spans('u.id, u.order, s.fn()'), [
      ['property', 'id'],
      ['property', 'order'],
      ['function', 'fn'],
    ]);
  });

  it('classifies numbers', () => {
    deepStrictEqual(spans('1 1.5 .5 2. 1e10 1.5E-3 0xFF'), [
      ['number', '1'],
      ['number', '1.5'],
      ['number', '.5'],
      ['number', '2.'],
      ['number', '1e10'],
      ['number', '1.5E-3'],
      ['number', '0xFF'],
    ]);
  });

  it('keeps digits inside an identifier plain', () => {
    deepStrictEqual(spans('t1 _2'), []);
  });

  it('classifies function calls', () => {
    deepStrictEqual(spans('coalesce(a, 0) + lower (b)'), [
      ['function', 'coalesce'],
      ['number', '0'],
    ]);
  });

  it('classifies a keyword called directly as a function', () => {
    deepStrictEqual(spans('replace(a), LEFT(a), right(a), left (a), create or replace view'), [
      ['function', 'replace'],
      ['function', 'LEFT'],
      ['function', 'right'],
      ['keyword', 'left'],
      ['keyword', 'create'],
      ['keyword', 'or'],
      ['keyword', 'replace'],
      ['keyword', 'view'],
    ]);
  });

  it('classifies `NULLS LAST` and the current date, time and user as keywords', () => {
    deepStrictEqual(
      spans('nulls last, current_date, CURRENT_TIME, current_timestamp, current_user'),
      [
        ['keyword', 'nulls'],
        ['keyword', 'last'],
        ['keyword', 'current_date'],
        ['keyword', 'CURRENT_TIME'],
        ['keyword', 'current_timestamp'],
        ['keyword', 'current_user'],
      ],
    );
  });

  it('classifies data types, sized or bare', () => {
    deepStrictEqual(spans('id integer, name VARCHAR(255), at timestamptz, n numeric(10, 2)'), [
      ['type', 'integer'],
      ['type', 'VARCHAR'],
      ['number', '255'],
      ['type', 'timestamptz'],
      ['type', 'numeric'],
      ['number', '10'],
      ['number', '2'],
    ]);
  });

  it('classifies a type name called with an argument as a function', () => {
    deepStrictEqual(spans("date('now')"), [
      ['function', 'date'],
      ['string', "'now'"],
    ]);
  });

  it('classifies every parameter style as a variable', () => {
    deepStrictEqual(spans('$1 ? ?2 :name @id @@version'), [
      ['variable', '$1'],
      ['variable', '?'],
      ['variable', '?2'],
      ['variable', ':name'],
      ['variable', '@id'],
      ['variable', '@@version'],
    ]);
  });

  it('reads a `::` cast as a type, never a parameter', () => {
    deepStrictEqual(spans('x::int'), [['type', 'int']]);
  });

  it('classifies a realistic statement', () => {
    const code = [
      'CREATE TABLE IF NOT EXISTS "posts" (',
      '  id INTEGER PRIMARY KEY AUTOINCREMENT,',
      "  title TEXT NOT NULL DEFAULT '' -- shown",
      ');',
    ].join('\n');
    deepStrictEqual(spans(code), [
      ['keyword', 'CREATE'],
      ['keyword', 'TABLE'],
      ['keyword', 'IF'],
      ['keyword', 'NOT'],
      ['keyword', 'EXISTS'],
      ['property', '"posts"'],
      ['type', 'INTEGER'],
      ['keyword', 'PRIMARY'],
      ['keyword', 'KEY'],
      ['keyword', 'AUTOINCREMENT'],
      ['type', 'TEXT'],
      ['keyword', 'NOT'],
      ['keyword', 'NULL'],
      ['keyword', 'DEFAULT'],
      ['string', "''"],
      ['comment', '-- shown'],
    ]);
  });

  it('leaves operators, a lone minus and a lone slash plain', () => {
    deepStrictEqual(spans('a - b / c <> d || e'), []);
  });

  it('ends an unterminated string at its line', () => {
    deepStrictEqual(spans("'open\nselect"), [
      ['string', "'open"],
      ['keyword', 'select'],
    ]);
  });

  it('ends an unterminated quoted identifier at its line', () => {
    deepStrictEqual(spans('"open\n`b\n1'), [
      ['property', '"open'],
      ['property', '`b'],
      ['number', '1'],
    ]);
  });

  it('runs an unterminated block comment and dollar quote to the end', () => {
    deepStrictEqual(spans('1 /* a\nselect'), [
      ['number', '1'],
      ['comment', '/* a\nselect'],
    ]);
    deepStrictEqual(spans('$x$ a\nselect'), [['string', '$x$ a\nselect']]);
  });

  it('emits sorted, non-empty, in-bounds tokens and scans to the end', () => {
    const code = 'sélect ünï \'a\'\u0000 "b" $ : @ ? . ` -- c\n/* d */ $1 ::x é() null';
    let last = 0;
    for (const token of tokenizeSQL(code)) {
      ok(token.start >= last && token.end > token.start && token.end <= code.length);
      last = token.end;
    }
    deepStrictEqual(last, code.length);
  });

  it('stays linear on adversarial input', () => {
    const inputs = [
      "'".repeat(1 << 20),
      "'a".repeat(1 << 19),
      '"a'.repeat(1 << 19),
      '/*'.repeat(1 << 19),
      '$a$'.repeat(1 << 18) + '$',
      '$a'.repeat(1 << 19),
      '--'.repeat(1 << 19),
      '1.'.repeat(1 << 19),
      '1e'.repeat(1 << 19),
      ':@?$'.repeat(1 << 18),
      'select('.repeat(1 << 17),
      'left('.repeat(1 << 18),
    ];
    for (const input of inputs) {
      const start = performance.now();
      tokenizeSQL(input);
      ok(performance.now() - start < 1000, input.slice(0, 8));
    }
  });
});
