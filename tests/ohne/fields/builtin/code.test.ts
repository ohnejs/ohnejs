import { deepStrictEqual, rejects, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { useCollections } from '../../../../src/ohne/collections/use-collections.ts';
import { SQLiteDialect } from '../../../../src/ohne/database/dialects/sqlite/dialect.ts';
import { buildDesiredSchema } from '../../../../src/ohne/database/schema/desired.ts';
import { syncDatabase } from '../../../../src/ohne/database/schema/sync.ts';
import { registerDatabase, registerDialect } from '../../../../src/ohne/database/use-database.ts';
import { code } from '../../../../src/ohne/fields/builtin/code.ts';
import { resolveFieldSearch } from '../../../../src/ohne/fields/field-search.ts';
import { field, resolveFieldOptions } from '../../../../src/ohne/fields/field.ts';
import { useFields } from '../../../../src/ohne/fields/use-fields.ts';
import { queryUntyped } from '../../../../src/ohne/query/query.ts';
import { isValidationError } from '../../../../src/ohne/query/write/errors.ts';
import { isUndefined } from '../../../../src/utils/index.ts';

type ValidateCtx = Parameters<NonNullable<typeof code.validators>[number]>[1];
type WriteCtx = Parameters<NonNullable<typeof code.sanitizers>[number]>[1];
type OptionsCtx = Parameters<NonNullable<typeof code.validateOptions>>[0];

const sanitize = (value: string) => code.sanitizers![0](value, {} as WriteCtx);
const validate = (value: string, options: Record<string, unknown> = {}): unknown => {
  const ctx = { options: { allowEmpty: false, ...options }, errors: {} } as unknown as ValidateCtx;
  for (const check of code.validators!) {
    const message = check(value, ctx);
    if (!isUndefined(message)) return message;
  }
  return undefined;
};
const checkOptions = (options: Record<string, unknown>) =>
  code.validateOptions!({
    name: 'snippet',
    options: { allowEmpty: false, indent: 2, wrap: false, ...options },
  } as unknown as OptionsCtx);

useCollections().register('Snippets', {
  name: 'Snippets',
  collection: {
    fields: {
      source: field('code', { language: 'ts', unique: true }),
      config: field('code', { language: 'json', nullable: true }),
    },
  },
});

const dialect = new SQLiteDialect();
const db = await dialect.connect(':memory:');
registerDialect(dialect);
registerDatabase(db);
await syncDatabase(db, dialect, {
  desired: buildDesiredSchema(useCollections(), useFields() as never),
});

describe('code sanitizer', () => {
  it('stores every line ending as `\\n`', () => {
    strictEqual(sanitize('a\r\nb\rc\nd'), 'a\nb\nc\nd');
    strictEqual(sanitize('\r\n\r\n'), '\n\n');
  });
});

describe('code validator', () => {
  it('rejects an empty value unless `allowEmpty`', () => {
    strictEqual(validate(''), 'validation.emptyValue');
    strictEqual(validate('', { allowEmpty: true }), undefined);
  });

  it('bounds the length by `min` and `max`', () => {
    deepStrictEqual(validate('ab', { min: 3 }), {
      key: 'validation.minLength',
      params: { min: 3 },
    });
    deepStrictEqual(validate('abcd', { max: 3 }), {
      key: 'validation.maxLength',
      params: { max: 3 },
    });
  });

  it('checks JSON under `language: json`, in any case', () => {
    strictEqual(validate('{ "a": 1 }', { language: 'json' }), undefined);
    strictEqual(validate('{ a: 1 }', { language: 'json' }), 'validation.invalidJSON');
    strictEqual(validate('{ a: 1 }', { language: 'JSON' }), 'validation.invalidJSON');
  });

  it('never checks JSON under another language or `languageFrom`', () => {
    strictEqual(validate('{ a: 1 }', { language: 'jsonc' }), undefined);
    strictEqual(validate('{ a: 1 }', { language: 'ts' }), undefined);
    strictEqual(validate('{ a: 1 }', { languageFrom: 'format' }), undefined);
  });

  it('leaves an empty JSON value to `allowEmpty`', () => {
    strictEqual(validate('', { language: 'json', allowEmpty: true }), undefined);
    strictEqual(validate('', { language: 'json' }), 'validation.emptyValue');
  });
});

describe('code validateOptions', () => {
  it('accepts the defaults, a language, a sibling path and a tab', () => {
    strictEqual(checkOptions({}), undefined);
    strictEqual(checkOptions({ language: 'ts' }), undefined);
    strictEqual(checkOptions({ languageFrom: '../file.path' }), undefined);
    strictEqual(checkOptions({ indent: 'tab' }), undefined);
    strictEqual(checkOptions({ indent: 8 }), undefined);
  });

  it('refuses `language` beside `languageFrom`', () => {
    deepStrictEqual(checkOptions({ language: 'ts', languageFrom: 'format' }), [
      'The field sets both `language` and `languageFrom`.',
      'Keep `language` for a fixed language, or `languageFrom` to follow a sibling field.',
    ]);
  });

  it('refuses a `languageFrom` that is no field path', () => {
    deepStrictEqual(checkOptions({ languageFrom: 'file..path' }), [
      '`languageFrom` is `file..path`, which is no field path.',
      'Write it as `when` does: `language`, `../file.path` or `/kind`.',
    ]);
  });

  it('refuses an `indent` out of bounds or fractional', () => {
    for (const indent of [0, 9, 1.5]) {
      deepStrictEqual(checkOptions({ indent }), [
        `\`indent\` is \`${indent}\`, which the field cannot use.`,
        "Write it as `'tab'`, or a whole number of spaces from `1` to `8`.",
      ]);
    }
  });

  it('refuses inverted length bounds first', () => {
    deepStrictEqual(checkOptions({ min: 5, max: 1, indent: 0 }), [
      '`min` is `5`, above `max` `1`, so no value can pass.',
      'Swap them, or lower `min`.',
    ]);
  });
});

describe('code options', () => {
  it('resolves its defaults', () => {
    const { allowEmpty, indent, wrap } = resolveFieldOptions(code, {});
    deepStrictEqual({ allowEmpty, indent, wrap }, { allowEmpty: false, indent: 2, wrap: false });
  });

  it('keeps search off until a field sets `search: true`', () => {
    strictEqual(resolveFieldSearch(code, {}, undefined), false);
    strictEqual(resolveFieldSearch(code, { search: true }, undefined), true);
  });
});

describe('code writes', () => {
  it('stores LF, so a CRLF spelling of a value is not unique', async () => {
    const snippet = await queryUntyped('Snippets').createOrThrow({ source: 'a\r\nb' });
    strictEqual(snippet.source, 'a\nb');
    await rejects(
      queryUntyped('Snippets').createOrThrow({ source: 'a\nb' }),
      (error) => isValidationError(error) && error.errors.source === 'validation.notUnique',
    );
  });

  it('keeps the formatting of valid JSON and rejects text that does not parse', async () => {
    const snippet = await queryUntyped('Snippets').createOrThrow({
      source: 'c',
      config: '{\n    "a": 1\n}',
    });
    strictEqual(snippet.config, '{\n    "a": 1\n}');
    await rejects(
      queryUntyped('Snippets').createOrThrow({ source: 'd', config: '{ a: 1 }' }),
      (error) => isValidationError(error) && error.errors.config === 'validation.invalidJSON',
    );
  });
});
