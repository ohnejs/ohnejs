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
