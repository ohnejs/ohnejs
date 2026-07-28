import { deepStrictEqual, match, ok, strictEqual, throws } from 'node:assert';
import { describe, it } from 'node:test';

import type { FieldInstance } from '../../../src/ohne/fields/field.ts';
import type { FieldTypeName } from '../../../src/ohne/fields/known-fields.ts';

import { useBlocks } from '../../../src/ohne/blocks/use-blocks.ts';
import { useCollections } from '../../../src/ohne/collections/use-collections.ts';
import { isOhneError } from '../../../src/ohne/error/ohne-error.ts';
import { blocks } from '../../../src/ohne/fields/builtin/blocks.ts';
import { boolean } from '../../../src/ohne/fields/builtin/boolean.ts';
import { integer } from '../../../src/ohne/fields/builtin/integer.ts';
import { object } from '../../../src/ohne/fields/builtin/object.ts';
import { record } from '../../../src/ohne/fields/builtin/record.ts';
import { records } from '../../../src/ohne/fields/builtin/records.ts';
import { repeater } from '../../../src/ohne/fields/builtin/repeater.ts';
import { text } from '../../../src/ohne/fields/builtin/text.ts';
import { defineField } from '../../../src/ohne/fields/define-field.ts';
import { field } from '../../../src/ohne/fields/field.ts';
import { useFields } from '../../../src/ohne/fields/use-fields.ts';
import { blockQueryMetadata, queryMetadata } from '../../../src/ohne/query/metadata.ts';

function plain(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(plain);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value)) out[key] = plain((value as Record<string, unknown>)[key]);
    return out;
  }
  return value;
}

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

const TEXT = { ...COMMON, allowEmpty: false };

const LIST = { ...COMMON, allowEmpty: true };

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

const heroFields = {
  title: field('text'),
  gallery: field('repeater', { fields: { caption: field('text') } }),
};
const quoteFields = { words: field('text'), cite: field('text', { nullable: true }) };
useBlocks().register('QHero', { name: 'QHero', block: { fields: heroFields } });
useBlocks().register('QQuote', { name: 'QQuote', block: { fields: quoteFields } });

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

useCollections().register('QLocTags', {
  name: 'QLocTags',
  collection: {
    fields: {
      label: field('text'),
      articles: field('records', { collection: 'QLocArticles', inverse: 'tags' }),
    },
  },
});
useCollections().register('QLocArticles', {
  name: 'QLocArticles',
  collection: {
    fields: {
      title: field('text', { translatable: true }),
      author: field('record', { collection: 'QUsers', translatable: true }),
      tags: field('records', { collection: 'QLocTags', translatable: true }),
      meta: field('object', { translatable: true, fields: { description: field('text') } }),
      sections: field('repeater', { translatable: true, fields: { heading: field('text') } }),
    },
  },
});
useCollections().register('QLocGalleries', {
  name: 'QLocGalleries',
  collection: {
    fields: {
      slides: field('repeater', { translatable: true, fields: { caption: field('text') } }),
    },
  },
});

useFields().register('qTagList', {
  name: 'qTagList' as FieldTypeName,
  fieldType: defineField({ columnType: 'json', jsonList: true, forceNullable: true }),
});
useFields().register('qBag', {
  name: 'qBag' as FieldTypeName,
  fieldType: defineField({ columnType: 'json', forceNullable: true }),
});

useCollections().register('QFlags', {
  name: 'QFlags',
  collection: {
    fields: {
      secret: field('text', { readable: false }),
      token: field('text', { writable: false, default: 'sealed' }),
      slug: field('text', { immutable: true }),
      members: field('records', { collection: 'QUsers', readable: false }),
      steps: field('repeater', { fields: { label: field('text') }, readable: false }),
      tags: { type: 'qTagList', options: {} } as unknown as FieldInstance,
      blob: { type: 'qBag', options: {} } as unknown as FieldInstance,
    },
  },
});

describe('queryMetadata', () => {
  it('builds the field table with a null prototype, so an inherited name reads as absent', () => {
    strictEqual(Object.getPrototypeOf(queryMetadata('QPosts').fields), null);
    strictEqual(queryMetadata('QPosts').fields['__proto__' as string], undefined);
  });

  it('builds the full per-field table', () => {
    deepStrictEqual(plain(queryMetadata('QPosts')), {
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
          options: TEXT,
          nullable: false,
          logicalType: 'text',
          column: 'title',
        },
        summary: {
          kind: 'column',
          fieldType: text,
          options: { ...TEXT, nullable: true },
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
          options: { ...LIST, collection: 'QTags' },
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
              options: { ...TEXT, nullable: true },
              nullable: true,
              logicalType: 'text',
              column: 'description',
            },
            links: {
              kind: 'childMany',
              fieldType: repeater,
              options: { ...LIST, fields: linkFields },
              nullable: false,
              table: 'QPosts_meta_links',
              subfields: {
                UUID: UUID_ENTRY,
                url: {
                  kind: 'column',
                  fieldType: text,
                  options: TEXT,
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
          options: { ...LIST, fields: sectionFields },
          nullable: false,
          table: 'QPosts_sections',
          subfields: {
            UUID: UUID_ENTRY,
            heading: {
              kind: 'column',
              fieldType: text,
              options: TEXT,
              nullable: false,
              logicalType: 'text',
              column: 'heading',
            },
          },
        },
        content: {
          kind: 'blocks',
          fieldType: blocks,
          options: LIST,
          nullable: false,
          table: 'QPosts_content',
          allow: ['QHero', 'QQuote'],
        },
      },
      compositeUniques: [],
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
      'content',
    ]);
  });

  it('points an inverse records field at the owning junction', () => {
    deepStrictEqual(queryMetadata('QTags').fields.posts, {
      kind: 'records',
      fieldType: records,
      options: { ...LIST, collection: 'QPosts', inverse: 'tags' },
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

describe('queryMetadata blocks', () => {
  it('resolves an explicit allow list, sorted and frozen', () => {
    useCollections().register('QBanners', {
      name: 'QBanners',
      collection: { fields: { content: field('blocks', { allow: ['QQuote', 'QHero'] }) } },
    });
    const entry = queryMetadata('QBanners').fields.content!;
    deepStrictEqual(entry.allow, ['QHero', 'QQuote']);
    ok(Object.isFrozen(entry.allow));
  });

  it('throws for an allow naming an unregistered block', () => {
    useCollections().register('QBadAllow', {
      name: 'QBadAllow',
      collection: { fields: { content: field('blocks', { allow: ['Ghost'] }) } },
    });
    throws(
      () => queryMetadata('QBadAllow'),
      (error: unknown) => {
        ok(isOhneError(error));
        match(error.message, /allows unknown block `Ghost`/);
        return true;
      },
    );
  });

  it('marks a translatable blocks field `localeScoped` and raises `translatable`', () => {
    useCollections().register('QLocPages', {
      name: 'QLocPages',
      collection: { fields: { content: field('blocks', { translatable: true }) } },
    });
    const meta = queryMetadata('QLocPages');
    strictEqual(meta.fields.content!.localeScoped, true);
    strictEqual(meta.translatable, true);
    strictEqual(meta.companionTable, undefined);
  });
});

describe('blockQueryMetadata', () => {
  it('builds the per-type table and fields, the item `UUID` seeded first', () => {
    const meta = blockQueryMetadata('QQuote');
    strictEqual(meta.name, 'QQuote');
    strictEqual(meta.table, 'block_QQuote');
    deepStrictEqual(Object.keys(meta.fields), ['UUID', 'words', 'cite']);
    deepStrictEqual(plain(meta.fields.UUID), UUID_ENTRY);
    strictEqual(meta.fields.cite!.nullable, true);
  });

  it('recurses into composites, derived tables composed from the block root', () => {
    const gallery = blockQueryMetadata('QHero').fields.gallery!;
    strictEqual(gallery.kind, 'childMany');
    strictEqual(gallery.table, 'block_QHero_gallery');
    deepStrictEqual(Object.keys(gallery.subfields!), ['UUID', 'caption']);
  });

  it('carries `allow` alone for a nested blocks field, so self-nesting cannot recurse', () => {
    useBlocks().register('QTower', {
      name: 'QTower',
      block: { fields: { parts: field('blocks', { allow: ['QTower', 'QHero'] }) } },
    });
    const parts = blockQueryMetadata('QTower').fields.parts!;
    strictEqual(parts.kind, 'blocks');
    strictEqual(parts.table, 'block_QTower_parts');
    deepStrictEqual(parts.allow, ['QHero', 'QTower']);
    strictEqual(parts.subfields, undefined);
  });

  it('memoizes per block', () => {
    strictEqual(blockQueryMetadata('QHero'), blockQueryMetadata('QHero'));
  });

  it('rejects a cascade record field anywhere inside a block, naming its path', () => {
    useBlocks().register('QCascade', {
      name: 'QCascade',
      block: {
        fields: {
          rows: field('repeater', {
            fields: { person: field('record', { collection: 'QUsers', onDelete: 'cascade' }) },
          }),
        },
      },
    });
    throws(
      () => blockQueryMetadata('QCascade'),
      (error: unknown) => {
        ok(isOhneError(error));
        match(error.message, /Block `QCascade` cascades `rows\.person` under its wrapper/);
        return true;
      },
    );
  });

  it('throws for an unknown block, naming it', () => {
    throws(
      () => blockQueryMetadata('Nope'),
      (error: unknown) => {
        ok(isOhneError(error));
        match(error.message, /Unknown block `Nope`/);
        return true;
      },
    );
  });

  it('accepts a bare sibling `when` path and rejects an anchored one', () => {
    useBlocks().register('QGated', {
      name: 'QGated',
      block: {
        fields: {
          kind: field('text'),
          note: field('text', { nullable: true, when: { kind: 'special' } }),
        },
      },
    });
    deepStrictEqual(plain(blockQueryMetadata('QGated').fields.note!.when), {
      kind: 'compare',
      path: ['kind'],
      op: 'equalsTo',
      value: 'special',
      negated: false,
    });

    useBlocks().register('QAnchored', {
      name: 'QAnchored',
      block: {
        fields: {
          note: field('text', { nullable: true, when: { '../kind': 'special' } }),
        },
      },
    });
    throws(
      () => blockQueryMetadata('QAnchored'),
      (error: unknown) => {
        ok(isOhneError(error));
        match(error.message, /anchors outside the block/);
        return true;
      },
    );
  });
});

describe('queryMetadata translations', () => {
  it('marks a translatable text column and a translatable record `companion`', () => {
    const { fields } = queryMetadata('QLocArticles');
    strictEqual(fields.title!.companion, true);
    strictEqual(fields.author!.companion, true);
  });

  it('marks translatable records, object, and repeater fields `localeScoped`, never `companion`', () => {
    const { fields } = queryMetadata('QLocArticles');
    for (const name of ['tags', 'meta', 'sections']) {
      strictEqual(fields[name]!.localeScoped, true);
      strictEqual(fields[name]!.companion, undefined);
    }
  });

  it('marks the inverse of a translatable junction `localeScoped`', () => {
    strictEqual(queryMetadata('QLocTags').fields.articles!.inverse, true);
    strictEqual(queryMetadata('QLocTags').fields.articles!.localeScoped, true);
  });

  it('leaves the inverse side non-translatable when it owns no translatable field', () => {
    strictEqual(queryMetadata('QLocTags').translatable, undefined);
    strictEqual(queryMetadata('QLocTags').companionTable, undefined);
  });

  it('raises `translatable` and names the companion table when a companion field exists', () => {
    strictEqual(queryMetadata('QLocArticles').translatable, true);
    strictEqual(queryMetadata('QLocArticles').companionTable, 'QLocArticles__translations');
  });

  it('raises `translatable` without a companion table for a lone translatable composite', () => {
    strictEqual(queryMetadata('QLocGalleries').translatable, true);
    strictEqual(queryMetadata('QLocGalleries').companionTable, undefined);
  });

  it('carries none of the markers on a non-translatable collection', () => {
    const posts = queryMetadata('QPosts');
    strictEqual(posts.translatable, undefined);
    strictEqual(posts.companionTable, undefined);
    for (const entry of Object.values(posts.fields)) {
      strictEqual(entry.companion, undefined);
      strictEqual(entry.localeScoped, undefined);
    }
  });
});

describe('queryMetadata field flags', () => {
  it('marks a `readable: false` column, the resolved option matching', () => {
    const entry = queryMetadata('QFlags').fields.secret!;
    strictEqual(entry.readable, false);
    strictEqual(entry.options!.readable, false);
    strictEqual(entry.writable, undefined);
    strictEqual(entry.immutable, undefined);
  });

  it('marks `writable: false` and `immutable: true` columns, each flag alone', () => {
    const { fields } = queryMetadata('QFlags');
    strictEqual(fields.token!.writable, false);
    strictEqual(fields.token!.options!.writable, false);
    strictEqual(fields.token!.readable, undefined);
    strictEqual(fields.token!.immutable, undefined);
    strictEqual(fields.slug!.immutable, true);
    strictEqual(fields.slug!.options!.immutable, true);
    strictEqual(fields.slug!.readable, undefined);
    strictEqual(fields.slug!.writable, undefined);
  });

  it('carries `readable: false` on a records junction and a repeater child', () => {
    const { fields } = queryMetadata('QFlags');
    strictEqual(fields.members!.kind, 'records');
    strictEqual(fields.members!.readable, false);
    strictEqual(fields.steps!.kind, 'childMany');
    strictEqual(fields.steps!.readable, false);
  });

  it('marks a `jsonList` field type column; a plain `json` one stays bare', () => {
    const { fields } = queryMetadata('QFlags');
    strictEqual(fields.tags!.kind, 'column');
    strictEqual(fields.tags!.logicalType, 'json');
    strictEqual(fields.tags!.jsonList, true);
    strictEqual(fields.blob!.logicalType, 'json');
    strictEqual(fields.blob!.jsonList, undefined);
  });
});
