import { ok, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { useBlocks } from '../../../../src/ohne/blocks/use-blocks.ts';
import { useCollections } from '../../../../src/ohne/collections/use-collections.ts';
import { SQLiteDialect } from '../../../../src/ohne/database/dialects/sqlite/dialect.ts';
import { buildDesiredSchema } from '../../../../src/ohne/database/schema/desired.ts';
import { syncDatabase } from '../../../../src/ohne/database/schema/sync.ts';
import { registerDatabase, registerDialect } from '../../../../src/ohne/database/use-database.ts';
import { field } from '../../../../src/ohne/fields/field.ts';
import { useFields } from '../../../../src/ohne/fields/use-fields.ts';
import { queryUntyped } from '../../../../src/ohne/query/query.ts';
import { isArray } from '../../../../src/utils/index.ts';

useBlocks().register('DSHero', {
  name: 'DSHero',
  block: { fields: { title: field('text', { default: 'Untitled' }) } },
});

useCollections().register('DSPages', {
  name: 'DSPages',
  collection: {
    fields: {
      sections: field('repeater', {
        fields: { title: field('text'), body: field('blocks', { allow: ['DSHero'] }) },
      }),
    },
  },
});
useCollections().register('DSLists', {
  name: 'DSLists',
  collection: {
    fields: {
      groups: field('repeater', {
        fields: {
          title: field('text'),
          items: field('repeater', {
            fields: { title: field('text', { default: 'Untitled' }) },
            sanitizers: [(items: unknown) => (isArray(items) ? [...items] : items)],
          }),
        },
      }),
    },
  },
});
useCollections().register('DSCards', {
  name: 'DSCards',
  collection: {
    fields: {
      rows: field('repeater', {
        fields: {
          title: field('text'),
          extra: field('object', {
            fields: { title: field('text', { default: 'Untitled' }) },
            default: () => ({}),
          }),
        },
      }),
    },
  },
});
useCollections().register('DSGated', {
  name: 'DSGated',
  collection: {
    fields: {
      rows: field('repeater', {
        fields: {
          title: field('text'),
          mode: field('text'),
          extra: field('object', {
            fields: { title: field('text', { default: 'Untitled' }) },
            default: () => ({}),
            when: { mode: 'full' },
          }),
        },
      }),
    },
  },
});

const dialect = new SQLiteDialect();
const db = await dialect.connect(':memory:');
registerDialect(dialect);
registerDatabase(db);
await syncDatabase(db, dialect, {
  desired: buildDesiredSchema(useCollections(), useFields() as never, useBlocks()),
});

interface HeroSection {
  title: string;
  body: { block: string; fields: { title: string } }[];
}

describe('composite descent snapshot scoping', () => {
  it('defaults a block item field inside a repeater item on create', async () => {
    const created = await queryUntyped('DSPages').create({
      sections: [{ title: 'A', body: [{ block: 'DSHero', fields: {} }] }],
    });
    ok(created.ok);
    const sections = created.record.sections as HeroSection[];
    strictEqual(sections[0].body[0].fields.title, 'Untitled');
  });

  it('defaults a block item field inside a repeater item on update', async () => {
    const record = await queryUntyped('DSPages').createOrThrow({ sections: [] });
    const updated = await queryUntyped('DSPages')
      .where({ UUID: record.UUID })
      .update({ sections: [{ title: 'A', body: [{ block: 'DSHero', fields: {} }] }] });
    ok(updated.ok);
    const sections = updated.records[0].sections as HeroSection[];
    strictEqual(sections[0].body[0].fields.title, 'Untitled');
  });

  it('defaults a nested item field once a sanitizer replaced its list', async () => {
    const created = await queryUntyped('DSLists').create({
      groups: [{ title: 'A', items: [{}] }],
    });
    ok(created.ok);
    const groups = created.record.groups as { items: { title: string }[] }[];
    strictEqual(groups[0].items[0].title, 'Untitled');
  });

  it('defaults a subfield of an object that took its own default', async () => {
    const created = await queryUntyped('DSCards').create({ rows: [{ title: 'A' }] });
    ok(created.ok);
    const rows = created.record.rows as { extra: { title: string } }[];
    strictEqual(rows[0].extra.title, 'Untitled');
  });

  it('defaults a subfield of a gated object a create item turns inactive', async () => {
    const created = await queryUntyped('DSGated').create({
      rows: [{ title: 'A', mode: 'off', extra: { title: 'X' } }],
    });
    ok(created.ok);
    const rows = created.record.rows as { extra: { title: string } }[];
    strictEqual(rows[0].extra.title, 'Untitled');
  });

  it('defaults a subfield of a gated object an update item turns inactive', async () => {
    const record = await queryUntyped('DSGated').createOrThrow({ rows: [] });
    const updated = await queryUntyped('DSGated')
      .where({ UUID: record.UUID })
      .update({ rows: [{ title: 'A', mode: 'off', extra: { title: 'X' } }] });
    ok(updated.ok);
    const rows = updated.records[0].rows as { extra: { title: string } }[];
    strictEqual(rows[0].extra.title, 'Untitled');
  });
});
