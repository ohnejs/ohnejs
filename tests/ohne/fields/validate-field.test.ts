import { doesNotThrow, throws } from 'node:assert';
import { describe, it } from 'node:test';

import type { FieldType } from '../../../src/ohne/fields/define-field.ts';
import type { FieldInstance } from '../../../src/ohne/fields/field.ts';
import type { AnyOptionDef } from '../../../src/ohne/fields/option.ts';
import type { StorageHint } from '../../../src/ohne/fields/storage-hint.ts';

import { isOhneError } from '../../../src/ohne/error/ohne-error.ts';
import { defineField } from '../../../src/ohne/fields/define-field.ts';
import { option } from '../../../src/ohne/fields/option.ts';
import { validateField, validateFieldType } from '../../../src/ohne/fields/validate-field.ts';

const column: FieldType = defineField({ columnType: 'text' });
const columnLess: FieldType = defineField({
  columnType: false,
  schema: () => ({ kind: 'junction', collection: 'Tags' }),
});

const junction: StorageHint = { kind: 'junction', collection: 'Tags' };
const childOne: StorageHint = {
  kind: 'child',
  cardinality: 'one',
  subfields: { title: { type: 'text', options: {} } },
};
const childMany: StorageHint = {
  kind: 'child',
  cardinality: 'many',
  subfields: { title: { type: 'text', options: {} } },
};
const blocksHint: StorageHint = { kind: 'blocks' };

const throwsTitled = (fn: () => void, title: string) =>
  throws(fn, (error: unknown) => isOhneError(error) && error.title === title);

const check = (options: Record<string, unknown>, fieldType = column, hint?: StorageHint) =>
  validateField({
    owner: { kind: 'collection', name: 'Posts' },
    name: 'field',
    nested: false,
    instance: { type: 'x', options } as unknown as FieldInstance,
    fieldType,
    hint,
  });

describe('validateField default rules', () => {
  it('rejects a `null` default on a non-nullable column', () => {
    throws(() => check({ default: null }), /default to `null`/);
  });

  it('accepts a `null` default on a nullable column', () => {
    doesNotThrow(() => check({ nullable: true, default: null }));
  });

  it('accepts a literal default on a column', () => {
    doesNotThrow(() => check({ default: 'draft' }));
  });

  it('rejects a `null` default on a `records` relation', () => {
    throws(() => check({ default: null }, columnLess, junction), /default to `null`/);
  });

  it('rejects a `null` default on a repeater', () => {
    throws(() => check({ default: null }, columnLess, childMany), /default to `null`/);
  });

  it('rejects a `null` default on a blocks field', () => {
    throws(() => check({ default: null }, columnLess, blocksHint), /default to `null`/);
  });

  it('accepts a `null` default on an object, which clears the child row', () => {
    doesNotThrow(() => check({ default: null }, columnLess, childOne));
  });

  it('rejects a literal default on a relation or composite', () => {
    throws(() => check({ default: [] }, columnLess, junction), /callback default/);
    throws(() => check({ default: {} }, columnLess, childOne), /callback default/);
    throws(() => check({ default: [] }, columnLess, childMany), /callback default/);
  });

  it('rejects a literal default on a blocks field', () => {
    throws(() => check({ default: [] }, columnLess, blocksHint), /callback default/);
  });

  it('accepts a callback default on a relation or composite', () => {
    doesNotThrow(() => check({ default: () => [] }, columnLess, junction));
    doesNotThrow(() => check({ default: () => ({}) }, columnLess, childOne));
  });

  it('accepts a callback default on a blocks field', () => {
    doesNotThrow(() => check({ default: () => [] }, columnLess, blocksHint));
  });

  it('treats an explicit `undefined` default as absent, on a column and a relation alike', () => {
    doesNotThrow(() => check({ default: undefined }));
    doesNotThrow(() => check({ default: undefined }, columnLess, junction));
    doesNotThrow(() => check({ default: undefined }, columnLess, childMany));
  });
});

describe('validateField write flags', () => {
  it('rejects `immutable` beside `writable: false`', () => {
    throwsTitled(
      () => check({ writable: false, immutable: true }),
      'Field `field` sets `immutable` beside `writable: false`',
    );
  });

  it('rejects `writable: false` on a required column with no default', () => {
    throwsTitled(() => check({ writable: false }), 'Field `field` could never take a value');
  });

  it('rejects `writable: false` on a list that forbids the empty list', () => {
    const list: FieldType = defineField({
      columnType: 'json',
      jsonList: true,
      defaultValue: () => [],
    });
    throwsTitled(
      () => check({ writable: false, min: 1 }, list),
      'Field `field` could never take a value',
    );
    doesNotThrow(() => check({ writable: false }, list));
    doesNotThrow(() => check({ writable: false, min: 1, default: ['a'] }, list));
  });

  it('rejects `writable: false` on a list whose type forbids the empty list by default', () => {
    const list = (options: Record<string, AnyOptionDef>): FieldType =>
      defineField({ columnType: 'json', jsonList: true, defaultValue: () => [], options });
    throwsTitled(
      () => check({ writable: false }, list({ allowEmpty: option({ default: false }) })),
      'Field `field` could never take a value',
    );
    throwsTitled(
      () => check({ writable: false }, list({ min: option({ default: 1 }) })),
      'Field `field` could never take a value',
    );
  });

  it('accepts `writable: false` with a default', () => {
    doesNotThrow(() => check({ writable: false, default: 'seed' }));
  });

  it('accepts `writable: false` on a nullable column', () => {
    doesNotThrow(() => check({ writable: false, nullable: true }));
  });

  it('accepts `writable: false` on a column-less field with no default', () => {
    doesNotThrow(() => check({ writable: false }, columnLess, junction));
    doesNotThrow(() => check({ writable: false }, columnLess, childMany));
  });

  it('accepts `writable: false` when the field type carries a `defaultValue`', () => {
    const stamped: FieldType = defineField({ columnType: 'integer', defaultValue: () => 1 });
    doesNotThrow(() => check({ writable: false }, stamped));
  });

  it('rejects `immutable` on a subfield', () => {
    throwsTitled(
      () =>
        validateField({
          owner: { kind: 'collection', name: 'Posts' },
          name: 'field',
          nested: true,
          instance: { type: 'x', options: { immutable: true } } as unknown as FieldInstance,
          fieldType: column,
          hint: undefined,
        }),
      'Field `field` cannot be immutable',
    );
  });

  it('rejects `immutable` on a block field', () => {
    throwsTitled(
      () =>
        validateField({
          owner: { kind: 'block', name: 'Hero' },
          name: 'field',
          nested: false,
          instance: { type: 'x', options: { immutable: true } } as unknown as FieldInstance,
          fieldType: column,
          hint: undefined,
        }),
      'Field `field` cannot be immutable',
    );
  });
});

describe('validateFieldType jsonList', () => {
  it('rejects `jsonList` on a non-json column', () => {
    throwsTitled(
      () => validateFieldType({ columnType: 'text', jsonList: true }),
      'A `jsonList` field type needs a `json` column',
    );
  });

  it('accepts `jsonList` on a `json` column', () => {
    doesNotThrow(() => validateFieldType({ columnType: 'json', jsonList: true }));
  });
});

describe('validateField search', () => {
  const hook = () => ({ startsWith: 'x' });
  const locked: FieldType = defineField({ columnType: 'text', search: false });
  const bare: FieldType = defineField({ columnType: 'integer' });
  const optIn: FieldType = defineField({
    columnType: 'integer',
    search: { default: false, match: hook },
  });
  const hooked: FieldType = defineField({
    columnType: false,
    search: hook,
    schema: () => junction,
  });

  it('refuses a search hook on every field with a storage hint', () => {
    const title = 'Field type `x` declares a search hook that never runs';
    const foreignKey: StorageHint = { kind: 'foreignKey', collection: 'Tags' };
    const textHooked: FieldType = defineField({ columnType: 'text', search: hook });
    throwsTitled(() => check({}, textHooked, foreignKey), title);
    throwsTitled(() => check({}, hooked, junction), title);
    throwsTitled(() => check({}, hooked, childOne), title);
    throwsTitled(() => check({}, hooked, childMany), title);
    throwsTitled(() => check({}, hooked, blocksHint), title);
    const textOptIn: FieldType = defineField({
      columnType: 'text',
      search: { default: false, match: hook },
    });
    throwsTitled(() => check({}, textOptIn, foreignKey), title);
  });

  it('accepts `{ default: false }` without a hook on a relation', () => {
    const quiet: FieldType = defineField({
      columnType: false,
      search: { default: false },
      schema: () => junction,
    });
    doesNotThrow(() => check({ search: true }, quiet, junction));
  });

  it('refuses `search: true` on a locked type', () => {
    throwsTitled(() => check({ search: true }, locked), 'Field `field` cannot turn search on');
    doesNotThrow(() => check({ search: false }, locked));
  });

  it('refuses `search: true` on a column with nothing to match', () => {
    throwsTitled(
      () => check({ search: true }, bare),
      'Field `field` has nothing to match words against',
    );
    doesNotThrow(() => check({ search: false }, bare));
  });

  it('accepts `search: true` on a text column, a hooked column, and a relation', () => {
    doesNotThrow(() => check({ search: true }));
    doesNotThrow(() => check({ search: true }, optIn));
    doesNotThrow(() => check({ search: true }, columnLess, junction));
  });

  it('refuses `search: true` beside `readable: false`', () => {
    throwsTitled(
      () => check({ search: true, readable: false }),
      'Field `field` sets `search` beside `readable: false`',
    );
    doesNotThrow(() => check({ search: false, readable: false }));
  });
});

describe('validateFieldType search', () => {
  const title = "A field type's `search` must be `false`, a function, or `{ default: false }`";

  it('accepts `false`, a hook, and `{ default: false }` with or without `match`', () => {
    doesNotThrow(() => validateFieldType({ columnType: 'text', search: false }));
    doesNotThrow(() => validateFieldType({ columnType: 'text', search: () => null }));
    doesNotThrow(() => validateFieldType({ columnType: 'text', search: { default: false } }));
    doesNotThrow(() =>
      validateFieldType({ columnType: 'text', search: { default: false, match: () => null } }),
    );
  });

  it('refuses any other shape', () => {
    for (const search of [
      true,
      {},
      { default: true },
      { default: false, match: 'x' },
      { match: () => null },
    ]) {
      throwsTitled(() => validateFieldType({ columnType: 'text', search: search as false }), title);
    }
    throwsTitled(
      () =>
        validateFieldType({ columnType: 'text', search: { default: false, extra: 1 } as never }),
      title,
    );
  });

  it('reserves `search` as an option name', () => {
    throwsTitled(
      () =>
        validateFieldType({ columnType: 'text', options: { search: option({ default: true }) } }),
      'Field option `search` is reserved',
    );
  });
});
