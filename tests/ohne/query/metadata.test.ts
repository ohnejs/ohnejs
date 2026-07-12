import { deepStrictEqual, match, ok, strictEqual, throws } from 'node:assert';
import { describe, it } from 'node:test';

import type { FieldInstance } from '../../../src/ohne/fields/field.ts';

import { useCollections } from '../../../src/ohne/collections/use-collections.ts';
import { isOhneError } from '../../../src/ohne/error/ohne-error.ts';
import { boolean } from '../../../src/ohne/fields/builtin/boolean.ts';
import { integer } from '../../../src/ohne/fields/builtin/integer.ts';
import { object } from '../../../src/ohne/fields/builtin/object.ts';
import { record } from '../../../src/ohne/fields/builtin/record.ts';
import { records } from '../../../src/ohne/fields/builtin/records.ts';
import { repeater } from '../../../src/ohne/fields/builtin/repeater.ts';
import { text } from '../../../src/ohne/fields/builtin/text.ts';
import { field } from '../../../src/ohne/fields/field.ts';
import { queryMetadata } from '../../../src/ohne/query/metadata.ts';

const COMMON = {
  nullable: false,
  unique: false,
  index: false,
  translatable: false,
  uniquePerLocale: false,
  uniquePerParent: false,
};

const UUID_ENTRY = {
  kind: 'column',
  nullable: false,
  logicalType: 'text',
  column: 'UUID',
  id: true,
};

const linkFields = { url: field('text') };
const metaFields = {
  description: field('text', { nullable: true }),
  links: field('repeater', { fields: linkFields }),
};
const sectionFields = { heading: field('text') };

useCollections().register('QUsers', {
  name: 'QUsers',
  collection: { fields: { name: field('text') } },
});
useCollections().register('QTags', {
  name: 'QTags',
  collection: {
    fields: {
      label: field('text'),
      posts: field('records', { collection: 'QPosts', inverse: 'tags' }),
    },
  },
});
useCollections().register('QPosts', {
  name: 'QPosts',
  collection: {
    fields: {
      title: field('text'),
      summary: field('text', { nullable: true }),
      views: field('integer'),
      featured: field('boolean'),
      author: field('record', { collection: 'QUsers' }),
      tags: field('records', { collection: 'QTags' }),
      meta: field('object', { fields: metaFields }),
      sections: field('repeater', { fields: sectionFields }),
      content: field('blocks'),
    },
  },
});

describe('queryMetadata', () => {
  it('builds the full per-field table, blocks omitted', () => {
    deepStrictEqual(queryMetadata('QPosts'), {
      collection: 'QPosts',
      table: 'QPosts',
      fields: {
        UUID: UUID_ENTRY,
        _updatedAt: {
          kind: 'column',
          nullable: false,
          logicalType: 'integer',
          column: '_updatedAt',
        },
        title: {
          kind: 'column',
          fieldType: text,
          options: COMMON,
          nullable: false,
          logicalType: 'text',
          column: 'title',
        },
        summary: {
          kind: 'column',
          fieldType: text,
          options: { ...COMMON, nullable: true },
          nullable: true,
          logicalType: 'text',
          column: 'summary',
        },
        views: {
          kind: 'column',
          fieldType: integer,
          options: COMMON,
          nullable: false,
          logicalType: 'integer',
          column: 'views',
        },
        featured: {
          kind: 'column',
          fieldType: boolean,
          options: COMMON,
          nullable: false,
          logicalType: 'boolean',
          column: 'featured',
        },
        author: {
          kind: 'record',
          fieldType: record,
          options: { ...COMMON, nullable: true, collection: 'QUsers' },
          nullable: true,
          logicalType: 'text',
          column: 'author',
          target: 'QUsers',
        },
        tags: {
          kind: 'records',
          fieldType: records,
          options: { ...COMMON, collection: 'QTags' },
          nullable: false,
          target: 'QTags',
          table: 'QPosts_tags',
        },
        meta: {
          kind: 'childOne',
          fieldType: object,
          options: { ...COMMON, fields: metaFields },
          nullable: true,
          table: 'QPosts_meta',
          subfields: {
            UUID: UUID_ENTRY,
            description: {
              kind: 'column',
              fieldType: text,
              options: { ...COMMON, nullable: true },
              nullable: true,
              logicalType: 'text',
              column: 'description',
            },
            links: {
              kind: 'childMany',
              fieldType: repeater,
              options: { ...COMMON, fields: linkFields },
              nullable: false,
              table: 'QPosts_meta_links',
              subfields: {
                UUID: UUID_ENTRY,
                url: {
                  kind: 'column',
                  fieldType: text,
                  options: COMMON,
                  nullable: false,
                  logicalType: 'text',
                  column: 'url',
                },
              },
            },
          },
        },
        sections: {
          kind: 'childMany',
          fieldType: repeater,
          options: { ...COMMON, fields: sectionFields },
          nullable: false,
          table: 'QPosts_sections',
          subfields: {
            UUID: UUID_ENTRY,
            heading: {
              kind: 'column',
              fieldType: text,
              options: COMMON,
              nullable: false,
              logicalType: 'text',
              column: 'heading',
            },
          },
        },
      },
    });
  });

  it('orders fields as authored, system entries first', () => {
    deepStrictEqual(Object.keys(queryMetadata('QPosts').fields), [
      'UUID',
      '_updatedAt',
      'title',
      'summary',
      'views',
      'featured',
      'author',
      'tags',
      'meta',
      'sections',
    ]);
  });

  it('points an inverse records field at the owning junction', () => {
    deepStrictEqual(queryMetadata('QTags').fields.posts, {
      kind: 'records',
      fieldType: records,
      options: { ...COMMON, collection: 'QPosts', inverse: 'tags' },
      nullable: false,
      target: 'QPosts',
      inverse: true,
      table: 'QPosts_tags',
    });
  });

  it('memoizes per collection', () => {
    strictEqual(queryMetadata('QPosts'), queryMetadata('QPosts'));
  });

  it('freezes resolved options once, nested entries included', () => {
    const { fields } = queryMetadata('QPosts');
    ok(Object.isFrozen(fields.title!.options));
    ok(Object.isFrozen(fields.meta!.subfields!.links!.options));
  });

  it('throws for an unknown collection, naming it', () => {
    throws(
      () => queryMetadata('Nope'),
      (error: unknown) => {
        ok(isOhneError(error));
        match(error.message, /Unknown collection `Nope`/);
        return true;
      },
    );
  });

  it('throws for an unregistered field type, naming it', () => {
    useCollections().register('QBroken', {
      name: 'QBroken',
      collection: {
        fields: { mystery: { type: 'mystery', options: {} } as unknown as FieldInstance },
      },
    });
    throws(
      () => queryMetadata('QBroken'),
      (error: unknown) => {
        ok(isOhneError(error));
        match(error.message, /Unknown field type `mystery`/);
        return true;
      },
    );
  });
});
