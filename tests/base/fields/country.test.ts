import { deepStrictEqual, ok, rejects, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { FieldSearchContext } from '../../../src/ohne/fields/define-field.ts';

import countryField from '../../../src/base/fields/country.ts';
import { useCollections } from '../../../src/ohne/collections/use-collections.ts';
import { buildDesiredSchema } from '../../../src/ohne/database/schema/desired.ts';
import { syncDatabase } from '../../../src/ohne/database/schema/sync.ts';
import { registerDatabase, registerDialect } from '../../../src/ohne/database/use-database.ts';
import { searchHook } from '../../../src/ohne/fields/field-search.ts';
import { field } from '../../../src/ohne/fields/field.ts';
import { useFields } from '../../../src/ohne/fields/use-fields.ts';
import { fieldBaseType, fieldJSONType } from '../../../src/ohne/fields/value-type.ts';
import { usePrinter } from '../../../src/ohne/printer/use-printer.ts';
import { queryUntyped } from '../../../src/ohne/query/query.ts';
import { isValidationError } from '../../../src/ohne/query/write/errors.ts';
import { createTypeImports } from '../../../src/utils/codegen/index.ts';
import { connectTest, dialect } from '../../_dialect.ts';

usePrinter().configure({ stream: { write: () => true } });

useFields().register('country', { name: 'country', fieldType: countryField });

useCollections().register('Heroes', {
  name: 'Heroes',
  collection: {
    fields: {
      name: field('text'),
      homeland: field('country', { unique: true, nullable: true }),
      realm: field('country', { only: ['DE', 'AT'], nullable: true }),
    },
  },
});

const db = await connectTest();
registerDialect(dialect);
registerDatabase(db);
await syncDatabase(db, dialect, {
  desired: buildDesiredSchema(useCollections(), useFields() as never),
});

type OptionsCtx = Parameters<NonNullable<typeof countryField.validateOptions>>[0];

const checkOptions = (options: Record<string, unknown>) =>
  countryField.validateOptions!({ name: 'homeland', options } as unknown as OptionsCtx);

describe('country writes', () => {
  it('stores the code in upper case, so case never makes a second value', async () => {
    const hero = await queryUntyped('Heroes').createOrThrow({ name: 'Thrall', homeland: 'de' });
    strictEqual(hero.homeland, 'DE');
    await rejects(
      queryUntyped('Heroes').createOrThrow({ name: 'Jaina', homeland: 'DE' }),
      (error) => isValidationError(error) && error.errors.homeland === 'validation.notUnique',
    );
  });

  it('rejects an alias, a grouping and an alpha-3 code', async () => {
    for (const homeland of ['UK', 'EU', 'DEU']) {
      const result = await queryUntyped('Heroes').create({ name: homeland, homeland });
      ok(!result.ok);
      strictEqual(result.errors.homeland, 'validation.invalidCountry');
    }
  });

  it('refuses text that only upper-cases into a code', async () => {
    for (const homeland of ['ß', 'ﬁ', 'ın']) {
      const result = await queryUntyped('Heroes').create({ name: homeland, homeland });
      ok(!result.ok, homeland);
      strictEqual(result.errors.homeland, 'validation.invalidCountry');
    }
  });

  it('admits only the listed codes under `only`', async () => {
    const hero = await queryUntyped('Heroes').createOrThrow({ name: 'Anduin', realm: 'at' });
    strictEqual(hero.realm, 'AT');
    const result = await queryUntyped('Heroes').create({ name: 'Varian', realm: 'FR' });
    ok(!result.ok);
    strictEqual(result.errors.realm, 'validation.invalidChoice');
  });
});

describe('country validateOptions', () => {
  it('accepts upper-case codes and a valid default', () => {
    strictEqual(checkOptions({ only: ['DE', 'AT'], default: 'DE' }), undefined);
    strictEqual(checkOptions({}), undefined);
  });

  it('refuses an empty or repeating `only`', () => {
    deepStrictEqual(checkOptions({ only: [] }), [
      '`only` is empty, so no value can be chosen.',
      'List at least one code.',
    ]);
    deepStrictEqual(checkOptions({ only: ['DE', 'DE'] }), [
      '`only` repeats a code.',
      'Drop the duplicates:',
      '',
      '- `DE`',
    ]);
  });

  it('refuses a code that is none, or not in upper case', () => {
    deepStrictEqual(checkOptions({ only: ['DE', 'de', 'UK'] }), [
      '`only` lists values that are no ISO 3166-1 country code:',
      '',
      '- `de`',
      '- `UK`',
      '',
      'Write each code in upper case, like `DE`.',
    ]);
    deepStrictEqual(checkOptions({ default: 'de' }), [
      '`default` is `de`, which is no ISO 3166-1 country code.',
      'Write each code in upper case, like `DE`.',
    ]);
  });
});

describe('country search', () => {
  const search = (token: string, options: Record<string, unknown> = {}) =>
    searchHook(countryField)!({
      name: 'homeland',
      options,
      token,
    } as unknown as FieldSearchContext);

  it('stays off until a field opts in', () => {
    strictEqual((countryField.search as { default: false }).default, false);
  });

  it('matches the exact code in any case, or a word start of the name', () => {
    deepStrictEqual(search('de'), { in: ['DE', 'DK'] });
    deepStrictEqual(search('germ'), { in: ['DE'] });
    deepStrictEqual(search('bosnia'), { in: ['BA'] });
  });

  it('keeps to `only`, and gives `null` without a hit', () => {
    strictEqual(search('fr', { only: ['DE', 'AT'] }), null);
    strictEqual(search('land'), null);
  });
});

describe('country types', () => {
  const imports = createTypeImports('/app/.ohne/shared');
  const args = (options: Record<string, unknown>) => ({
    fieldType: countryField,
    name: 'homeland',
    type: 'country',
    options,
    imports,
  });

  it('types the value `CountryCode`, or the union of `only`', () => {
    strictEqual(fieldBaseType({ ...args({}), fieldDir: '/app/fields' }).base, 'CountryCode');
    strictEqual(
      fieldBaseType({ ...args({ only: ['DE', 'AT'] }), fieldDir: '/app/fields' }).base,
      "'DE' | 'AT'",
    );
  });

  it('inlines the codes for a website', () => {
    strictEqual(fieldJSONType({ ...args({ only: ['DE'] }), mirror: () => undefined }).base, "'DE'");
    ok(fieldJSONType({ ...args({}), mirror: () => undefined }).base.startsWith("'AD' | 'AE'"));
  });
});
