import { doesNotThrow, throws } from 'node:assert';
import { describe, it } from 'node:test';

import type { FieldType } from '../../../src/ohne/fields/define-field.ts';
import type { FieldInstance } from '../../../src/ohne/fields/field.ts';
import type { StorageHint } from '../../../src/ohne/fields/storage-hint.ts';

import { defineField } from '../../../src/ohne/fields/define-field.ts';
import { validateField } from '../../../src/ohne/fields/validate-field.ts';

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
