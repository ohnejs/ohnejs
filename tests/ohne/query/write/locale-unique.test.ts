import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { useCollections } from '../../../../src/ohne/collections/use-collections.ts';
import { SQLiteDialect } from '../../../../src/ohne/database/dialects/sqlite/dialect.ts';
import { buildDesiredSchema } from '../../../../src/ohne/database/schema/desired.ts';
import { syncDatabase } from '../../../../src/ohne/database/schema/sync.ts';
import { registerDatabase, registerDialect } from '../../../../src/ohne/database/use-database.ts';
import { field } from '../../../../src/ohne/fields/field.ts';
import { useFields } from '../../../../src/ohne/fields/use-fields.ts';
import { useLayers } from '../../../../src/ohne/layers/use-layers.ts';
import { queryUntyped } from '../../../../src/ohne/query/query.ts';

useLayers().add({
  path: '/locale-unique',
  input: { collections: { locales: ['en', 'de'], defaultLocale: 'en' } },
});

useCollections().register('LUSlugs', {
  name: 'LUSlugs',
  collection: { fields: { slug: field('text', { unique: true, translatable: true }) } },
});
useCollections().register('LUHandles', {
  name: 'LUHandles',
  collection: {
    fields: {
      handle: field('text', { unique: true, translatable: true, uniquePerLocale: true }),
    },
  },
});
useCollections().register('LURace', {
  name: 'LURace',
  collection: {
    fields: {
      slug: field('text', { unique: true, translatable: true }),
      title: field('text', { translatable: true }),
      subtitle: field('text', { translatable: true }),
    },
    compositeIndexes: [{ fields: ['title', 'subtitle'], unique: true }],
  },
});

const dialect = new SQLiteDialect();
const db = await dialect.connect(':memory:');
registerDialect(dialect);
registerDatabase(db);
await syncDatabase(db, dialect, {
  desired: buildDesiredSchema(useCollections(), useFields() as never),
});

describe('checkUnique under locales', () => {
  it('collides a plain unique translatable value across locales', async () => {
    const first = await queryUntyped('LUSlugs').create({ slug: 'x' });
    ok(first.ok);
    const second = await queryUntyped('LUSlugs').locale('de').create({ slug: 'x' });
    ok(!second.ok);
    strictEqual(second.errors.slug, 'validation.notUnique');
  });

  it('scopes a uniquePerLocale value to one locale', async () => {
    const en = await queryUntyped('LUHandles').create({ handle: 'h' });
    ok(en.ok);
    const de = await queryUntyped('LUHandles').locale('de').create({ handle: 'h' });
    ok(de.ok);
    const again = await queryUntyped('LUHandles').locale('de').create({ handle: 'h' });
    ok(!again.ok);
    strictEqual(again.errors.handle, 'validation.notUnique');
  });

  it('excludes the updated record itself from the probe by parent', async () => {
    const a = await queryUntyped('LUSlugs').create({ slug: 'a' });
    const b = await queryUntyped('LUSlugs').create({ slug: 'b' });
    ok(a.ok);
    ok(b.ok);
    const kept = await queryUntyped('LUSlugs').where({ UUID: a.record.UUID }).update({ slug: 'a' });
    ok(kept.ok);
    strictEqual(kept.records.length, 1);
    strictEqual(kept.records[0].slug, 'a');
    const clash = await queryUntyped('LUSlugs')
      .where({ UUID: a.record.UUID })
      .update({ slug: 'b' });
    ok(!clash.ok);
    strictEqual(clash.errors.slug, 'validation.notUnique');
  });

  it('prechecks a translatable composite on its companion, keying every covered field', async () => {
    await db.run('INSERT INTO "LURace" ("UUID","_updatedAt") VALUES (?,?)', ['r0', 1]);
    await db.run(
      'INSERT INTO "LURace__translations" ("_parentUUID","_localeCode","slug","title","subtitle") ' +
        'VALUES (?,?,?,?,?)',
      ['r0', 'en', 'taken', 'a', 'b'],
    );
    const result = await queryUntyped('LURace').create({
      slug: 'fresh',
      title: 'a',
      subtitle: 'b',
    });
    ok(!result.ok);
    deepStrictEqual(result.errors, {
      title: 'validation.notUnique',
      subtitle: 'validation.notUnique',
    });
    const rows = await db.query('SELECT "UUID" FROM "LURace"');
    strictEqual(rows.length, 1);
  });

  it('spans locales: a translatable composite collides across the whole companion', async () => {
    const en = await queryUntyped('LURace').create({ slug: 's1', title: 'x', subtitle: 'y' });
    ok(en.ok);
    const de = await queryUntyped('LURace')
      .locale('de')
      .create({ slug: 's2', title: 'x', subtitle: 'y' });
    ok(!de.ok);
    deepStrictEqual(de.errors, {
      title: 'validation.notUnique',
      subtitle: 'validation.notUnique',
    });
  });
});
