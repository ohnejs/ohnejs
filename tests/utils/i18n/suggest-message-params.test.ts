import { deepStrictEqual, strictEqual, throws } from 'node:assert';
import { describe, it } from 'node:test';

import { MessageSyntaxError } from '../../../src/utils/i18n/message-errors.ts';
import { parseMessage } from '../../../src/utils/i18n/parse-message.ts';
import {
  suggestMessageParams,
  suggestMessageParamsAST,
} from '../../../src/utils/i18n/suggest-message-params.ts';

const SAMPLE_DATE = new Date(Date.UTC(2024, 5, 17, 14, 30, 45));

describe('suggestMessageParams - argument-free templates', () => {
  it('returns a single default row for plain literal text', () => {
    deepStrictEqual(suggestMessageParams('hello world'), [{ params: {}, label: 'default' }]);
  });

  it('returns a single default row for the empty template', () => {
    deepStrictEqual(suggestMessageParams(''), [{ params: {}, label: 'default' }]);
  });
});

describe('suggestMessageParams - plain arguments', () => {
  it('uses the argument name as the sample for plain `{name}`', () => {
    deepStrictEqual(suggestMessageParams('Hello {name}!'), [
      { params: { name: 'name' }, label: 'default' },
    ]);
  });

  it('only registers the first occurrence; reused names do not double-sample', () => {
    deepStrictEqual(suggestMessageParams('{a} and {a}'), [
      { params: { a: 'a' }, label: 'default' },
    ]);
  });
});

describe('suggestMessageParams - typed simple arguments', () => {
  it('samples `{n, number}` with a decimal that exposes grouping', () => {
    deepStrictEqual(suggestMessageParams('{n, number}'), [
      { params: { n: 1234.5 }, label: 'default' },
    ]);
  });

  it('samples `{n, number, integer}` with an integer', () => {
    deepStrictEqual(suggestMessageParams('{n, number, integer}'), [
      { params: { n: 1234 }, label: 'default' },
    ]);
  });

  it('samples `{n, number, percent}` with 0.42 so it reads as `42%`', () => {
    deepStrictEqual(suggestMessageParams('{n, number, percent}'), [
      { params: { n: 0.42 }, label: 'default' },
    ]);
  });

  it('samples `{n, number, ::currency/EUR}` with a decimal currency amount', () => {
    deepStrictEqual(suggestMessageParams('{n, number, ::currency/EUR}'), [
      { params: { n: 1234.5 }, label: 'default' },
    ]);
  });

  it('samples `{n, number, ::compact-short}` with a value big enough to compact', () => {
    deepStrictEqual(suggestMessageParams('{n, number, ::compact-short}'), [
      { params: { n: 12345 }, label: 'default' },
    ]);
  });

  it('samples `{n, number, ::scientific}` with a value that exercises notation', () => {
    deepStrictEqual(suggestMessageParams('{n, number, ::scientific}'), [
      { params: { n: 12345 }, label: 'default' },
    ]);
  });

  it('samples `{n, number, ::percent}` skeleton like the bare style', () => {
    deepStrictEqual(suggestMessageParams('{n, number, ::percent}'), [
      { params: { n: 0.42 }, label: 'default' },
    ]);
  });

  it('samples `{d, date}` with a fixed Date constant', () => {
    deepStrictEqual(suggestMessageParams('on {d, date, long}'), [
      { params: { d: SAMPLE_DATE }, label: 'default' },
    ]);
  });

  it('samples `{d, time}` with the same fixed Date constant', () => {
    deepStrictEqual(suggestMessageParams('at {d, time, short}'), [
      { params: { d: SAMPLE_DATE }, label: 'default' },
    ]);
  });
});

describe('suggestMessageParams - plural (en)', () => {
  it('emits a row per keyword case (one + other)', () => {
    deepStrictEqual(suggestMessageParams('{n, plural, one {# item} other {# items}}'), [
      { params: { n: 1 }, label: 'default' },
      { params: { n: 0 }, label: 'n: other' },
    ]);
  });

  it('takes `=N` exacts literally and names them with the `=N` keyword', () => {
    deepStrictEqual(
      suggestMessageParams('{n, plural, =0 {nothing} one {# item} other {# items}}'),
      [
        { params: { n: 0 }, label: 'default' },
        { params: { n: 1 }, label: 'n: one' },
        { params: { n: 2 }, label: 'n: other' },
      ],
    );
  });

  it('avoids picking a probe value that any `=N` already claims', () => {
    const out = suggestMessageParams('{n, plural, =1 {one} one {# item} other {# items}}');
    const ones = out.filter((s) => s.label === 'n: one');
    strictEqual(ones.length, 0);
    const others = out.filter((s) => s.label === 'n: other');
    strictEqual(others.length, 1);
    strictEqual(others[0]!.params.n, 0);
  });

  it('respects offset when picking samples and exposes the offset boundary', () => {
    deepStrictEqual(
      suggestMessageParams('{n, plural, offset:1 =0 {nothing} one {one less} other {#}}'),
      [
        { params: { n: 0 }, label: 'default' },
        { params: { n: 2 }, label: 'n: one' },
        { params: { n: 1 }, label: 'n: other' },
      ],
    );
  });

  it('suppresses the offset boundary when an `=N` exact already claims it', () => {
    const out = suggestMessageParams(
      '{n, plural, offset:5 =5 {at five} =6 {six} other {something}}',
    );
    deepStrictEqual(out, [
      { params: { n: 5 }, label: 'default' },
      { params: { n: 6 }, label: 'n: =6' },
      { params: { n: 7 }, label: 'n: other' },
    ]);
  });

  it('emits an explicit boundary row when no probe or exact covers offset+1', () => {
    const out = suggestMessageParams('{n, plural, offset:5 other {x}}', { locale: 'ja' });
    deepStrictEqual(out, [
      { params: { n: 5 }, label: 'default' },
      { params: { n: 6 }, label: 'n: 6 (boundary)' },
    ]);
  });
});

describe('suggestMessageParams - select', () => {
  it('emits a row per declared keyword', () => {
    deepStrictEqual(
      suggestMessageParams('{gender, select, female {she} male {he} other {they}} arrived'),
      [
        { params: { gender: 'female' }, label: 'default' },
        { params: { gender: 'male' }, label: 'gender: male' },
        { params: { gender: 'other' }, label: 'gender: other' },
      ],
    );
  });
});

describe('suggestMessageParams - selectordinal (en)', () => {
  it('uses ordinal plural rules to sample each declared case', () => {
    deepStrictEqual(
      suggestMessageParams('{n, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}'),
      [
        { params: { n: 1 }, label: 'default' },
        { params: { n: 2 }, label: 'n: two' },
        { params: { n: 3 }, label: 'n: few' },
        { params: { n: 0 }, label: 'n: other' },
      ],
    );
  });
});

describe('suggestMessageParams - nested arguments', () => {
  it('holds outer arg at first sample when varying inner; covers every (outer, inner) cell', () => {
    const out = suggestMessageParams(
      '{count, plural, ' +
        'one {{gender, select, female {girl} male {boy} other {kid}}} ' +
        'other {{gender, select, female {girls} male {boys} other {kids}}}}',
    );
    deepStrictEqual(out, [
      { params: { count: 1, gender: 'female' }, label: 'default' },
      { params: { count: 0, gender: 'female' }, label: 'count: other' },
      { params: { count: 1, gender: 'male' }, label: 'gender: male' },
      { params: { count: 1, gender: 'other' }, label: 'gender: other' },
      { params: { count: 0, gender: 'male' }, label: 'gender: male' },
      { params: { count: 0, gender: 'other' }, label: 'gender: other' },
    ]);
  });

  it('also samples plain args reached inside a plural arm', () => {
    deepStrictEqual(suggestMessageParams('{n, plural, one {{color} cat} other {# {color} cats}}'), [
      { params: { n: 1, color: 'color' }, label: 'default' },
      { params: { n: 0, color: 'color' }, label: 'n: other' },
    ]);
  });
});

describe('suggestMessageParams - locale gap finding', () => {
  it('surfaces locale categories the AST does not declare with a `(locale-only)` label', () => {
    const out = suggestMessageParams('{n, plural, one {# item} other {# items}}', {
      locale: 'ar',
    });

    deepStrictEqual(out.map((s) => s.label).sort(), [
      'default',
      'n: few (locale-only)',
      'n: many (locale-only)',
      'n: other',
      'n: two (locale-only)',
      'n: zero (locale-only)',
    ]);

    strictEqual(out[0]!.label, 'default');
    strictEqual(out[0]!.params.n, 1);
  });

  it('default locale is `en` so only en categories are sampled', () => {
    const out = suggestMessageParams('{n, plural, one {# item} other {# items}}');
    strictEqual(out.length, 2);
    strictEqual(
      out.every((s) => !s.label.includes('locale-only')),
      true,
    );
  });
});

describe('suggestMessageParams - same name reused across nodes', () => {
  it('merges variations and uses the first-occurrence sample as the default', () => {
    const out = suggestMessageParams('{n, plural, one {# item} other {# items}}; total: {n}');
    strictEqual(out.length, 2);
    strictEqual(out[0]!.params.n, 1);
  });
});

describe('suggestMessageParamsAST', () => {
  it('accepts a pre-parsed AST', () => {
    const ast = parseMessage('Hello {name}!');
    deepStrictEqual(suggestMessageParamsAST(ast), [{ params: { name: 'name' }, label: 'default' }]);
  });
});

describe('suggestMessageParams - syntax errors', () => {
  it('propagates MessageSyntaxError from parseMessage', () => {
    throws(() => suggestMessageParams('{n, plural, one {x}}'), MessageSyntaxError);
  });
});
