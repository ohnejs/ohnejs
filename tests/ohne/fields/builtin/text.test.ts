import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { text } from '../../../../src/ohne/fields/builtin/text.ts';
import { resolveFieldOptions } from '../../../../src/ohne/fields/field.ts';

type Ctx = Parameters<NonNullable<typeof text.validators>[number]>[1];

const ctx = (options: Record<string, unknown>) => ({ options, errors: {} }) as unknown as Ctx;

const empty = text.validators![0];
const length = text.validators![1];

describe('text emptiness', () => {
  it('rejects an empty string by default', () => {
    strictEqual(empty('', ctx({ allowEmpty: false })), 'validation.emptyValue');
  });

  it('accepts an empty string under `allowEmpty`', () => {
    strictEqual(empty('', ctx({ allowEmpty: true })), undefined);
  });

  it('accepts a non-empty string either way', () => {
    strictEqual(empty('x', ctx({ allowEmpty: false })), undefined);
    strictEqual(empty('x', ctx({ allowEmpty: true })), undefined);
  });
});

describe('text length bounds', () => {
  it('rejects a value shorter than `min`', () => {
    deepStrictEqual(length('ab', ctx({ min: 3 })), {
      key: 'validation.minLength',
      params: { min: 3 },
    });
  });

  it('rejects a value longer than `max`', () => {
    deepStrictEqual(length('abcd', ctx({ max: 3 })), {
      key: 'validation.maxLength',
      params: { max: 3 },
    });
  });

  it('accepts a value within bounds', () => {
    strictEqual(length('abc', ctx({ min: 3, max: 3 })), undefined);
    strictEqual(length('anything', ctx({})), undefined);
  });
});

describe('text resolved options', () => {
  it('resolves `multiline` and `allowEmpty` to their defaults', () => {
    const resolved = resolveFieldOptions(text, {});
    strictEqual(resolved.multiline, false);
    strictEqual(resolved.allowEmpty, false);
  });

  it('keeps a passed `multiline`', () => {
    strictEqual(resolveFieldOptions(text, { multiline: true }).multiline, true);
  });
});
