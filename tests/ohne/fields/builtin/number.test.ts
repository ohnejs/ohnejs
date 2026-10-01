import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { FieldSearchContext } from '../../../../src/ohne/fields/define-field.ts';

import { number } from '../../../../src/ohne/fields/builtin/number.ts';
import { searchHook } from '../../../../src/ohne/fields/field-search.ts';

type Ctx = Parameters<NonNullable<typeof number.validators>[number]>[1];

const ctx = (options: Record<string, unknown> = {}) => ({ options, errors: {} }) as unknown as Ctx;

const bounds = number.validators![0];

describe('number bounds', () => {
  it('rejects a value below `min`', () => {
    deepStrictEqual(bounds(0.5, ctx({ min: 1.5 })), {
      key: 'validation.minValue',
      params: { min: 1.5 },
    });
  });

  it('rejects a value above `max`', () => {
    deepStrictEqual(bounds(2.5, ctx({ max: 2 })), {
      key: 'validation.maxValue',
      params: { max: 2 },
    });
  });

  it('accepts a value within bounds', () => {
    strictEqual(bounds(1.25, ctx({ min: 1, max: 1.5 })), undefined);
    strictEqual(bounds(1.5, ctx({ min: 1.5 })), undefined);
    strictEqual(bounds(2, ctx({ max: 2 })), undefined);
    strictEqual(bounds(-0.5, ctx()), undefined);
  });
});

const numberSearch = searchHook(number)!;

const search = (token: string, options: Record<string, unknown> = {}) =>
  numberSearch({
    name: 'field',
    options,
    token,
    resolveMessage: (message) => (message === 'app.status.live' ? 'Published' : String(message)),
  } as FieldSearchContext);

describe('number search', () => {
  it('matches a numeric token by equality', () => {
    deepStrictEqual(search('1.5'), { equalsTo: 1.5 });
    deepStrictEqual(search('42'), { equalsTo: 42 });
  });

  it('gives `null` for a non-numeric or infinite token', () => {
    for (const token of ['abc', '1.2.3', '1e999']) strictEqual(search(token), null);
  });
});
