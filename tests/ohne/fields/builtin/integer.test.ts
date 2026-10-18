import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { FieldSearchContext } from '../../../../src/ohne/fields/define-field.ts';

import { integer } from '../../../../src/ohne/fields/builtin/integer.ts';
import { searchHook } from '../../../../src/ohne/fields/field-search.ts';

type Ctx = Parameters<NonNullable<typeof integer.validators>[number]>[1];

const ctx = (options: Record<string, unknown> = {}) => ({ options, errors: {} }) as unknown as Ctx;

const bounds = integer.validators![0];

describe('integer bounds', () => {
  it('rejects a value below `min`', () => {
    deepStrictEqual(bounds(1, ctx({ min: 2 })), {
      key: 'validation.minValue',
      params: { min: 2 },
    });
  });

  it('rejects a value above `max`', () => {
    deepStrictEqual(bounds(11, ctx({ max: 10 })), {
      key: 'validation.maxValue',
      params: { max: 10 },
    });
  });

  it('accepts a value within bounds', () => {
    strictEqual(bounds(5, ctx({ min: 2, max: 10 })), undefined);
    strictEqual(bounds(2, ctx({ min: 2 })), undefined);
    strictEqual(bounds(10, ctx({ max: 10 })), undefined);
    strictEqual(bounds(-100, ctx()), undefined);
  });
});

const integerSearch = searchHook(integer)!;

const search = (token: string, options: Record<string, unknown> = {}) =>
  integerSearch({
    name: 'field',
    options,
    token,
    resolveMessage: (message) => (message === 'app.status.live' ? 'Published' : String(message)),
  } as FieldSearchContext);

describe('integer search', () => {
  it('matches an integer token by equality', () => {
    deepStrictEqual(search('1042'), { equalsTo: 1042 });
    deepStrictEqual(search('0'), { equalsTo: 0 });
    deepStrictEqual(search('0042'), { equalsTo: 42 });
  });

  it('gives `null` for a non-integer or unsafe token', () => {
    for (const token of ['1.5', '1e3', 'abc', '9007199254740993']) strictEqual(search(token), null);
  });
});

describe('integer currency', () => {
  const checkOptions = (options: Record<string, unknown>) =>
    integer.validateOptions!({
      name: 'price',
      options: { display: 'input', ...options },
    } as unknown as Parameters<NonNullable<typeof integer.validateOptions>>[0]);

  it('names a failing bound as an amount in the currency', () => {
    deepStrictEqual(bounds(999, ctx({ currency: 'EUR', min: 1234 })), {
      key: 'validation.minValue',
      params: { min: '12.34 EUR' },
    });
    deepStrictEqual(bounds(5000, ctx({ currency: 'JPY', max: 4999 })), {
      key: 'validation.maxValue',
      params: { max: '4999 JPY' },
    });
    strictEqual(bounds(1234, ctx({ currency: 'EUR', min: 0 })), undefined);
  });

  it('matches an amount token in major units', () => {
    deepStrictEqual(search('12,34', { currency: 'EUR' }), { equalsTo: 1234 });
    deepStrictEqual(search('12', { currency: 'EUR' }), { equalsTo: 1200 });
    strictEqual(search('12.345', { currency: 'EUR' }), null);
    deepStrictEqual(search('1234', { currency: 'JPY' }), { equalsTo: 1234 });
  });

  it('accepts a circulating ISO 4217 code', () => {
    strictEqual(checkOptions({ currency: 'EUR', min: 0 }), undefined);
  });

  it('refuses a code that is no circulating currency', () => {
    for (const currency of ['eur', 'ABC', 'XAU']) {
      deepStrictEqual(checkOptions({ currency }), [
        `\`currency\` is \`${currency}\`, which is no ISO 4217 currency.`,
        'Use an upper-case code of a circulating currency, like `EUR`.',
      ]);
    }
  });

  it('refuses a unit suffix, a step grid or a slider beside it', () => {
    deepStrictEqual(checkOptions({ currency: 'EUR', suffix: 'EUR' }), [
      '`currency` and `suffix` cannot meet: an amount reads in its currency.',
      'Drop `suffix`.',
    ]);
    strictEqual(
      checkOptions({ currency: 'EUR', step: 5 })?.[0],
      '`currency` and `step` cannot meet: an amount reads in its currency.',
    );
    strictEqual(
      checkOptions({ currency: 'EUR', display: 'slider', min: 0, max: 100 })?.[0],
      "`currency` and `display: 'slider'` cannot meet: an amount reads in its currency.",
    );
  });

  it('refuses a bound that is no whole count of minor units', () => {
    for (const [name, bound] of [
      ['min', 0.5],
      ['max', 1e21],
    ] as const) {
      deepStrictEqual(checkOptions({ currency: 'EUR', [name]: bound }), [
        `\`${name}\` is \`${bound}\`, but \`currency\` counts whole minor units.`,
        `Write \`${name}\` in minor units, like \`1999\` for 19.99.`,
      ]);
    }
  });

  it('names the currency clash before the grid and slider rules', () => {
    strictEqual(
      checkOptions({ currency: 'EUR', display: 'slider' })?.[0],
      "`currency` and `display: 'slider'` cannot meet: an amount reads in its currency.",
    );
  });
});
