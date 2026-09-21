import { deepStrictEqual, strictEqual, throws } from 'node:assert';
import { describe, it } from 'node:test';

import { formatMessageAST } from '../../../src/utils/i18n/format-message-ast.ts';
import { MessageFormatError } from '../../../src/utils/i18n/message-errors.ts';
import { parseMessage } from '../../../src/utils/i18n/parse-message.ts';

const render = (template: string, params?: Record<string, unknown>, language = 'en-US'): string =>
  formatMessageAST(parseMessage(template), params, language);

describe('formatMessageAST - literals and arguments', () => {
  it('emits literals verbatim', () => {
    strictEqual(render('Hello, world!'), 'Hello, world!');
  });

  it('renders a simple argument by name', () => {
    strictEqual(render('Hello, {name}!', { name: 'Jaina' }), 'Hello, Jaina!');
  });

  it('coerces numeric arguments to string via String()', () => {
    strictEqual(render('count={n}', { n: 7 }), 'count=7');
  });

  it('coerces bigint via String()', () => {
    strictEqual(render('count={n}', { n: 123n }), 'count=123');
  });

  it('renders the placeholder when an argument is missing', () => {
    strictEqual(render('Hello, {name}!', {}), 'Hello, {name}!');
  });

  it('renders the placeholder when params is undefined', () => {
    strictEqual(render('Hello, {name}!'), 'Hello, {name}!');
  });

  it('treats `null` as missing', () => {
    strictEqual(render('Hello, {name}!', { name: null }), 'Hello, {name}!');
  });

  it('treats `undefined` as missing (own key with undefined value)', () => {
    strictEqual(render('Hello, {name}!', { name: undefined }), 'Hello, {name}!');
  });

  it('does not consult inherited prototype keys', () => {
    const params = Object.create({ name: 'Inherited' }) as Record<string, unknown>;
    strictEqual(render('Hello, {name}!', params), 'Hello, {name}!');
  });

  it('supports positional names like `{0}`', () => {
    strictEqual(render('{0} and {1}', { 0: 'a', 1: 'b' }), 'a and b');
  });
});

describe('formatMessageAST - apostrophe escapes via parseMessage', () => {
  it("renders `''` as a literal apostrophe", () => {
    strictEqual(render("it''s"), "it's");
  });

  it('renders quoted braces as literals', () => {
    strictEqual(render("'{escaped}'"), '{escaped}');
  });

  it('keeps a lone apostrophe before non-syntax text', () => {
    strictEqual(render("don't"), "don't");
  });
});

describe('formatMessageAST - number', () => {
  it('formats with default style', () => {
    strictEqual(render('{n, number}', { n: 1234.5 }, 'en-US'), '1,234.5');
  });

  it('formats integer style (rounds to whole)', () => {
    strictEqual(render('{n, number, integer}', { n: 1234.6 }, 'en-US'), '1,235');
  });

  it('formats percent style', () => {
    strictEqual(render('{n, number, percent}', { n: 0.42 }, 'en-US'), '42%');
  });

  it('coerces a decimal-shaped string to number', () => {
    strictEqual(render('{n, number}', { n: '1234.5' }, 'en-US'), '1,234.5');
  });

  it('renders placeholder when the value cannot be coerced', () => {
    strictEqual(render('{n, number}', { n: 'abc' }, 'en-US'), '{n}');
  });

  it('renders placeholder for a missing argument', () => {
    strictEqual(render('{n, number}', {}, 'en-US'), '{n}');
  });

  it('throws on bare `currency` style', () => {
    throws(() => render('{n, number, currency}', { n: 5 }), MessageFormatError);
  });

  it('formats `::currency/EUR` skeleton', () => {
    const out = render('{n, number, ::currency/EUR}', { n: 9.5 }, 'en-US');
    strictEqual(out.includes('9.50'), true);
    strictEqual(out.includes('€') || out.includes('EUR'), true);
  });

  it('formats `::.00` fraction skeleton (exact two digits)', () => {
    strictEqual(render('{n, number, ::.00}', { n: 3 }, 'en-US'), '3.00');
  });

  it('throws on an unknown style', () => {
    throws(() => render('{n, number, mystery}', { n: 5 }), MessageFormatError);
  });

  it('uses German grouping when the locale is de-DE', () => {
    const out = render('{n, number}', { n: 1234.5 }, 'de-DE');
    strictEqual(out.includes('1.234'), true);
    strictEqual(out.includes(','), true);
  });
});

describe('formatMessageAST - date and time', () => {
  const epoch = new Date(Date.UTC(2026, 5, 7, 14, 30, 0));

  it('formats `{d, date}` with default (medium) style', () => {
    const expected = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(epoch);
    strictEqual(render('{d, date}', { d: epoch }, 'en-US'), expected);
  });

  it('formats `{d, date, short}` in en-US shape', () => {
    const out = render('{d, date, short}', { d: epoch }, 'en-US');
    strictEqual(/\d/.test(out), true);
  });

  it('accepts an ISO date string and formats it', () => {
    const expected = new Intl.DateTimeFormat('en-US', { dateStyle: 'short' }).format(
      new Date('2026-06-07'),
    );
    strictEqual(render('{d, date, short}', { d: '2026-06-07' }, 'en-US'), expected);
  });

  it('accepts a unix timestamp number', () => {
    const expected = new Intl.DateTimeFormat('en-US', { dateStyle: 'short' }).format(epoch);
    strictEqual(render('{d, date, short}', { d: epoch.getTime() }, 'en-US'), expected);
  });

  it('renders placeholder when the value cannot be coerced to a Date', () => {
    strictEqual(render('{d, date, short}', { d: 'not a date' }), '{d}');
  });

  it('renders placeholder when the argument is missing', () => {
    strictEqual(render('{d, date, short}', {}), '{d}');
  });

  it('formats `{d, time, short}`', () => {
    const expected = new Intl.DateTimeFormat('en-US', { timeStyle: 'short' }).format(epoch);
    strictEqual(render('{d, time, short}', { d: epoch }, 'en-US'), expected);
  });

  it('throws on an unknown date style', () => {
    throws(() => render('{d, date, mystery}', { d: epoch }), MessageFormatError);
  });

  it('formats a `::yMMMMd` date skeleton distinctly from the medium fallback', () => {
    const expected = new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }).format(epoch);
    const medium = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(epoch);
    strictEqual(render('{d, date, ::yMMMMd}', { d: epoch }, 'en-US'), expected);
    strictEqual(expected !== medium, true);
  });
});

describe('formatMessageAST - plural', () => {
  it('selects `one` for n=1 in English', () => {
    strictEqual(render('{n, plural, one {# item} other {# items}}', { n: 1 }, 'en-US'), '1 item');
  });

  it('selects `other` for n=2 in English', () => {
    strictEqual(render('{n, plural, one {# item} other {# items}}', { n: 2 }, 'en-US'), '2 items');
  });

  it('renders `#` via the locale-aware number formatter', () => {
    strictEqual(render('{n, plural, other {#}}', { n: 1234.5 }, 'en-US'), '1,234.5');
  });

  it('honors `=N` exact match before category selection', () => {
    strictEqual(
      render('{n, plural, =0 {none} one {# item} other {# items}}', { n: 0 }, 'en-US'),
      'none',
    );
    strictEqual(
      render('{n, plural, =1 {just one} one {# item} other {# items}}', { n: 1 }, 'en-US'),
      'just one',
    );
  });

  it('subtracts offset from `#` substitution', () => {
    strictEqual(render('{n, plural, offset:1 other {#}}', { n: 5 }, 'en-US'), '4');
  });

  it('subtracts offset before plural-category selection', () => {
    strictEqual(
      render('{n, plural, offset:1 one {# kw one} other {# other}}', { n: 2 }, 'en-US'),
      '1 kw one',
    );
  });

  it('checks `=N` against the raw value (before offset)', () => {
    strictEqual(
      render('{n, plural, offset:1 =1 {exact one} one {# kw} other {# other}}', { n: 1 }, 'en-US'),
      'exact one',
    );
  });

  it('falls through to `other` when no keyword matches', () => {
    strictEqual(render('{n, plural, one {a} other {b}}', { n: 5 }, 'en-US'), 'b');
  });

  it('treats missing argument as 0; `=0` exact case wins', () => {
    strictEqual(render('{n, plural, =0 {none} other {many}}', {}, 'en-US'), 'none');
  });

  it('treats missing argument as 0; falls through to `other` when no exact case matches', () => {
    strictEqual(render('{n, plural, one {one} other {many}}', {}, 'en-US'), 'many');
  });

  it('selects different categories per locale (pl distinguishes few/many)', () => {
    const template = '{n, plural, one {one} few {few} many {many} other {other}}';
    strictEqual(render(template, { n: 1 }, 'pl'), 'one');
    strictEqual(render(template, { n: 2 }, 'pl'), 'few');
    strictEqual(render(template, { n: 5 }, 'pl'), 'many');
  });

  it('formats `selectordinal` via the ordinal PluralRules type', () => {
    const t = '{n, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}';
    strictEqual(render(t, { n: 1 }, 'en-US'), '1st');
    strictEqual(render(t, { n: 2 }, 'en-US'), '2nd');
    strictEqual(render(t, { n: 3 }, 'en-US'), '3rd');
    strictEqual(render(t, { n: 4 }, 'en-US'), '4th');
    strictEqual(render(t, { n: 22 }, 'en-US'), '22nd');
    strictEqual(render(t, { n: 23 }, 'en-US'), '23rd');
  });

  it('coerces a string count to a number', () => {
    strictEqual(
      render('{n, plural, one {# item} other {# items}}', { n: '3' }, 'en-US'),
      '3 items',
    );
  });
});

describe('formatMessageAST - select', () => {
  it('matches by keyword', () => {
    strictEqual(render('{g, select, male {he} female {she} other {they}}', { g: 'female' }), 'she');
  });

  it('falls back to `other` when no keyword matches', () => {
    strictEqual(
      render('{g, select, male {he} female {she} other {they}}', { g: 'unknown' }),
      'they',
    );
  });

  it('falls back to `other` when the argument is missing', () => {
    strictEqual(render('{g, select, male {he} female {she} other {they}}', {}), 'they');
  });

  it('coerces non-string values to a string key before matching', () => {
    strictEqual(render('{x, select, 1 {one} other {many}}', { x: 1 }), 'one');
  });
});

describe('formatMessageAST - nesting', () => {
  it('renders a simple argument inside a select branch', () => {
    strictEqual(
      render('{role, select, admin {Welcome, {name}!} other {Hi}}', {
        role: 'admin',
        name: 'Jaina',
      }),
      'Welcome, Jaina!',
    );
  });

  it('binds `#` inside a select-inside-plural to the outer plural', () => {
    const t =
      '{count, plural, offset:1 other {{g, select, female {she has # extra} other {they have # extra}}}}';
    strictEqual(render(t, { count: 5, g: 'female' }, 'en-US'), 'she has 4 extra');
  });

  it('rebinds `#` to the innermost plural', () => {
    const t = '{a, plural, other {{b, plural, other {#}}}}';
    strictEqual(render(t, { a: 5, b: 2 }, 'en-US'), '2');
  });
});

describe('formatMessageAST - onError', () => {
  it('calls onError on a missing simple argument', () => {
    const errors: MessageFormatError[] = [];
    const out = formatMessageAST(parseMessage('Hello, {name}!'), {}, 'en-US', {
      onError: (e) => errors.push(e),
    });
    strictEqual(out, 'Hello, {name}!');
    strictEqual(errors.length, 1);
    strictEqual(errors[0]!.message.includes('name'), true);
  });

  it('calls onError on a missing plural argument', () => {
    const errors: MessageFormatError[] = [];
    formatMessageAST(parseMessage('{n, plural, other {x}}'), {}, 'en-US', {
      onError: (e) => errors.push(e),
    });
    strictEqual(errors.length, 1);
  });

  it('calls onError on a plural argument that cannot be coerced', () => {
    const errors: MessageFormatError[] = [];
    formatMessageAST(parseMessage('{n, plural, other {#}}'), { n: 'abc' }, 'en-US', {
      onError: (e) => errors.push(e),
    });
    strictEqual(errors.length, 1);
    strictEqual(errors[0]!.message.includes('not a number'), true);
  });

  it('calls onError on a number argument that cannot be coerced', () => {
    const errors: MessageFormatError[] = [];
    const out = formatMessageAST(parseMessage('{n, number}'), { n: {} }, 'en-US', {
      onError: (e) => errors.push(e),
    });
    strictEqual(out, '{n}');
    strictEqual(errors.length, 1);
  });

  it('calls onError on a missing select argument', () => {
    const errors: MessageFormatError[] = [];
    const out = formatMessageAST(parseMessage('{g, select, male {he} other {they}}'), {}, 'en-US', {
      onError: (e) => errors.push(e),
    });
    strictEqual(out, 'they');
    strictEqual(errors.length, 1);
  });

  it('throws when onError throws (strict mode opt-in)', () => {
    throws(
      () =>
        formatMessageAST(parseMessage('Hello, {name}!'), {}, 'en-US', {
          onError: (e) => {
            throw e;
          },
        }),
      MessageFormatError,
    );
  });

  it('does not notify on successful formats', () => {
    let count = 0;
    formatMessageAST(parseMessage('Hello, {name}!'), { name: 'Jaina' }, 'en-US', {
      onError: () => count++,
    });
    strictEqual(count, 0);
  });
});

describe('formatMessageAST - structural sanity', () => {
  it('returns a string for an empty AST', () => {
    strictEqual(formatMessageAST([], {}, 'en-US'), '');
  });

  it('preserves ordering across many interleaved nodes', () => {
    strictEqual(render('{a}-{b}-{c}', { a: '1', b: '2', c: '3' }), '1-2-3');
  });

  it('does not mutate the params object', () => {
    const params = { name: 'Jaina' };
    const snapshot = structuredClone(params);
    formatMessageAST(parseMessage('Hello, {name}!'), params, 'en-US');
    deepStrictEqual(params, snapshot);
  });
});
