import { deepStrictEqual, doesNotThrow, ok, rejects, strictEqual, throws } from 'node:assert';
import { describe, it } from 'node:test';

import type { Transaction } from '../../../../src/ohne/database/adapter.ts';

import { defineCollection } from '../../../../src/ohne/collections/define-collection.ts';
import { useCollections } from '../../../../src/ohne/collections/use-collections.ts';
import { buildDesiredSchema } from '../../../../src/ohne/database/schema/desired.ts';
import { syncDatabase } from '../../../../src/ohne/database/schema/sync.ts';
import { registerDatabase, registerDialect } from '../../../../src/ohne/database/use-database.ts';
import { isOhneError } from '../../../../src/ohne/error/ohne-error.ts';
import { json } from '../../../../src/ohne/fields/builtin/json.ts';
import { resolveFieldSearch } from '../../../../src/ohne/fields/field-search.ts';
import { field } from '../../../../src/ohne/fields/field.ts';
import { useFields } from '../../../../src/ohne/fields/use-fields.ts';
import { validateField } from '../../../../src/ohne/fields/validate-field.ts';
import * as ohne from '../../../../src/ohne/index.ts';
import { queryUntyped } from '../../../../src/ohne/query/query.ts';
import { validateLiteralDefaults } from '../../../../src/ohne/query/validate-literal-defaults.ts';
import { isValidationError } from '../../../../src/ohne/query/write/errors.ts';
import { connectTest, dialect } from '../../../_dialect.ts';

type ValidateCtx = Parameters<NonNullable<typeof json.validators>[number]>[1];
type OptionsCtx = Parameters<NonNullable<typeof json.validateOptions>>[0];

const validate = (value: unknown, options: Record<string, unknown> = {}): unknown =>
  json.validators![0](value, { options, errors: {} } as unknown as ValidateCtx);
const checkOptions = (options: Record<string, unknown>) =>
  json.validateOptions!({ name: 'settings', options } as unknown as OptionsCtx);
const checkField = (options: Record<string, unknown>) =>
  validateField({
    owner: { kind: 'collection', name: 'Guilds' },
    name: 'settings',
    nested: false,
    instance: field('json', options as never),
    fieldType: json,
    hint: undefined,
  });

/**
 * An array nested `depth` levels deep around `1`.
 */
function nested(depth: number): unknown {
  let value: unknown = 1;
  for (let level = 0; level < depth; level++) value = [value];
  return value;
}

useCollections().register('Guilds', {
  name: 'Guilds',
  collection: {
    fields: {
      settings: field('json'),
      talents: field('json', { nullable: true, maxDepth: 2 }),
    },
  },
});

const db = await connectTest();
registerDialect(dialect);
registerDatabase(db);
await syncDatabase(db, dialect, {
  desired: buildDesiredSchema(useCollections(), useFields() as never),
});

describe('json validator', () => {
  it('accepts plain JSON data, a top-level scalar included', () => {
    strictEqual(validate({ raid: ['Icecrown', null], size: 25 }), undefined);
    strictEqual(validate('Frostmourne'), undefined);
    strictEqual(validate(0), undefined);
  });

  it('rejects what JSON would drop or distort', () => {
    strictEqual(validate({ at: new Date() }), 'validation.invalidJSON');
    strictEqual(validate({ a: undefined }), 'validation.invalidJSON');
    strictEqual(validate([NaN]), 'validation.invalidJSON');
  });

  it('bounds nesting by `maxDepth`, 32 when omitted', () => {
    strictEqual(validate(nested(32)), undefined);
    deepStrictEqual(validate(nested(33)), { key: 'validation.maxDepth', params: { max: 32 } });
    deepStrictEqual(validate([[1]], { maxDepth: 1 }), {
      key: 'validation.maxDepth',
      params: { max: 1 },
    });
  });
});

describe('json validateOptions', () => {
  it('accepts an omitted or whole `maxDepth`', () => {
    strictEqual(checkOptions({}), undefined);
    strictEqual(checkOptions({ maxDepth: 0 }), undefined);
    strictEqual(checkOptions({ maxDepth: 100 }), undefined);
  });

  it('refuses a negative or fractional `maxDepth`', () => {
    for (const maxDepth of [-1, 1.5, NaN]) {
      deepStrictEqual(checkOptions({ maxDepth }), [
        `\`maxDepth\` is \`${maxDepth}\`, which is no depth.`,
        'Set it to a whole number of `0` or more.',
      ]);
    }
  });
});

describe('json field rules', () => {
  it('locks search out', () => {
    strictEqual(resolveFieldSearch(json, {}, undefined), false);
    throws(() => checkField({ search: true }), /cannot turn search on/);
  });

  it('refuses `unique`, keeps `index`', () => {
    throws(
      () => checkField({ unique: true }),
      (error: unknown) => isOhneError(error) && error.title === 'Field `settings` cannot be unique',
    );
    doesNotThrow(() => checkField({ index: true, nullable: true }));
  });

  it('refuses a unique composite index over a json field', () => {
    throws(
      () =>
        defineCollection({
          fields: { guild: field('text'), settings: field('json') },
          compositeIndexes: [{ fields: ['guild', 'settings'], unique: true }],
        }),
      (error: unknown) =>
        isOhneError(error) &&
        error.title === 'A unique composite index includes `json` field `settings`',
    );
    doesNotThrow(() =>
      defineCollection({
        fields: { guild: field('text'), settings: field('json') },
        compositeIndexes: [{ fields: ['guild', 'settings'] }],
      }),
    );
  });

  it('checks a literal default against `maxDepth` at boot', async () => {
    useCollections().register('GuildDefaults', {
      name: 'GuildDefaults',
      collection: { fields: { settings: field('json', { maxDepth: 1, default: [[1]] }) } },
    } as never);
    try {
      await rejects(
        validateLiteralDefaults({} as Transaction),
        (error: unknown) =>
          isOhneError(error) && error.title === 'Field `settings` defaults to a value it rejects',
      );
    } finally {
      useCollections().delete('GuildDefaults');
    }
  });

  it('is exported from `ohnejs`', () => {
    strictEqual(ohne.json, json);
  });
});

describe('json writes', () => {
  it('round-trips nested data, nested `null` included', async () => {
    const value = { raid: 'Icecrown', bosses: [{ name: 'Arthas', loot: null }], heroic: true };
    const guild = await queryUntyped('Guilds').createOrThrow({ settings: value });
    deepStrictEqual(guild.settings, value);
    const [read] = await queryUntyped('Guilds').where({ UUID: guild.UUID }).findMany();
    deepStrictEqual(read?.settings, value);
  });

  it('stores a top-level `null` as the field null on a nullable field only', async () => {
    const guild = await queryUntyped('Guilds').createOrThrow({ settings: 1, talents: null });
    strictEqual(guild.talents, null);
    await rejects(
      queryUntyped('Guilds').createOrThrow({ settings: null }),
      (error) => isValidationError(error) && error.errors.settings === 'validation.notNullable',
    );
  });

  it('requires a non-nullable field on create', async () => {
    await rejects(
      queryUntyped('Guilds').createOrThrow({}),
      (error) => isValidationError(error) && error.errors.settings === 'validation.required',
    );
  });

  it('enforces `maxDepth` on a write', async () => {
    await rejects(
      queryUntyped('Guilds').createOrThrow({ settings: 1, talents: [[[1]]] }),
      (error) =>
        isValidationError(error) &&
        (error.errors.talents as { key?: string }).key === 'validation.maxDepth',
    );
  });

  it('offers `isNull` only on a nullable field', async () => {
    const rows = await queryUntyped('Guilds')
      .where({ talents: { isNull: true } })
      .findMany();
    ok(rows.length > 0);
    await rejects(async () =>
      queryUntyped('Guilds')
        .where({ settings: { isNull: true } })
        .findMany(),
    );
  });
});
