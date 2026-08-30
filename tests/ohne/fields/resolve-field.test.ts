import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { blocks } from '../../../src/ohne/fields/builtin/blocks.ts';
import { object } from '../../../src/ohne/fields/builtin/object.ts';
import { record } from '../../../src/ohne/fields/builtin/record.ts';
import { records } from '../../../src/ohne/fields/builtin/records.ts';
import { repeater } from '../../../src/ohne/fields/builtin/repeater.ts';
import { text } from '../../../src/ohne/fields/builtin/text.ts';
import { field } from '../../../src/ohne/fields/field.ts';
import { resolveFieldStorage } from '../../../src/ohne/fields/resolve-field.ts';

const COMMON = {
  nullable: false,
  unique: false,
  index: false,
  translatable: false,
  uniquePerLocale: false,
  uniquePerParent: false,
  readable: true,
  writable: true,
  immutable: false,
};

describe('resolveFieldStorage', () => {
  it('classifies a plain column with no hint', () => {
    deepStrictEqual(resolveFieldStorage('title', field('text'), text), {
      fieldType: text,
      options: { ...COMMON, allowEmpty: false, multiline: false },
      hint: undefined,
      kind: 'column',
    });
  });

  it('classifies a record as a foreign key, nullable forced', () => {
    const resolved = resolveFieldStorage(
      'author',
      field('record', { collection: 'Users' }),
      record,
    );
    strictEqual(resolved.kind, 'foreignKey');
    strictEqual(resolved.options.nullable, true);
    deepStrictEqual(resolved.hint, {
      kind: 'foreignKey',
      collection: 'Users',
      onDelete: undefined,
    });
  });

  it('classifies a records field as a junction', () => {
    const resolved = resolveFieldStorage('tags', field('records', { collection: 'Tags' }), records);
    strictEqual(resolved.kind, 'junction');
    deepStrictEqual(resolved.hint, {
      kind: 'junction',
      collection: 'Tags',
      inverse: undefined,
      onDelete: undefined,
    });
  });

  it('splits child hints by cardinality', () => {
    const subfields = { city: field('text') };
    const one = resolveFieldStorage('address', field('object', { fields: subfields }), object);
    strictEqual(one.kind, 'childOne');
    deepStrictEqual(one.hint, { kind: 'child', cardinality: 'one', subfields });
    const many = resolveFieldStorage('items', field('repeater', { fields: subfields }), repeater);
    strictEqual(many.kind, 'childMany');
    deepStrictEqual(many.hint, { kind: 'child', cardinality: 'many', subfields });
  });

  it('classifies a blocks field as blocks', () => {
    const resolved = resolveFieldStorage('content', field('blocks'), blocks);
    strictEqual(resolved.kind, 'blocks');
    deepStrictEqual(resolved.hint, { kind: 'blocks', allow: undefined });
  });

  it('resolves declared defaults alongside the common options', () => {
    deepStrictEqual(
      resolveFieldStorage('tags', field('records', { collection: 'Tags' }), records).options,
      {
        ...COMMON,
        allowEmpty: true,
        collection: 'Tags',
      },
    );
  });
});
