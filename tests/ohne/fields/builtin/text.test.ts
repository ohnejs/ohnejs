import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { text } from '../../../../src/ohne/fields/builtin/text.ts';
import { resolveFieldOptions } from '../../../../src/ohne/fields/field.ts';

type Ctx = Parameters<NonNullable<typeof text.validators>[number]>[1];

const ctx = (options: Record<string, unknown>) => ({ options, errors: {} }) as unknown as Ctx;

const validate = text.validators![0];

describe('text emptiness', () => {
  it('rejects an empty string by default', () => {
    strictEqual(validate('', ctx({ allowEmpty: false })), 'validation.emptyValue');
  });

  it('accepts an empty string under `allowEmpty`', () => {
    strictEqual(validate('', ctx({ allowEmpty: true })), undefined);
  });

  it('accepts a non-empty string either way', () => {
    strictEqual(validate('x', ctx({ allowEmpty: false })), undefined);
    strictEqual(validate('x', ctx({ allowEmpty: true })), undefined);
  });
});

describe('text length bounds', () => {
  it('rejects a value shorter than `min`', () => {
    deepStrictEqual(validate('ab', ctx({ min: 3 })), {
      key: 'validation.minLength',
      params: { min: 3 },
    });
  });

  it('rejects a value longer than `max`', () => {
    deepStrictEqual(validate('abcd', ctx({ max: 3 })), {
      key: 'validation.maxLength',
      params: { max: 3 },
    });
  });

  it('accepts a value within bounds', () => {
    strictEqual(validate('abc', ctx({ min: 3, max: 3 })), undefined);
    strictEqual(validate('anything', ctx({})), undefined);
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
