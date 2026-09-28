import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { DatabaseAdapter, SQLParams } from '../../../../../src/ohne/database/adapter.ts';
import type { FieldQueryMeta } from '../../../../../src/ohne/query/metadata.ts';

import { useCollections } from '../../../../../src/ohne/collections/use-collections.ts';
import { SQLiteDialect } from '../../../../../src/ohne/database/dialects/sqlite/dialect.ts';
import { buildDesiredSchema } from '../../../../../src/ohne/database/schema/desired.ts';
import { syncDatabase } from '../../../../../src/ohne/database/schema/sync.ts';
import {
  registerDatabase,
  registerDialect,
} from '../../../../../src/ohne/database/use-database.ts';
import { field } from '../../../../../src/ohne/fields/field.ts';
import { useFields } from '../../../../../src/ohne/fields/use-fields.ts';
import { useLayers } from '../../../../../src/ohne/layers/use-layers.ts';
import { queryMetadata } from '../../../../../src/ohne/query/metadata.ts';
import { queryUntyped } from '../../../../../src/ohne/query/query.ts';
import {
  loadTranslations,
  narrowTranslations,
} from '../../../../../src/ohne/query/read/loaders/translations.ts';
import { parseCondition, type ConditionNode } from '../../../../../src/utils/index.ts';

useLayers().add({
  path: '/translations-loader',
  input: { collections: { locales: ['en', 'de', 'fr'], defaultLocale: 'en' } },
});

useCollections().register('LTPosts', {
  name: 'LTPosts',
  collection: {
    fields: {
      title: field('text', { translatable: true }),
      sections: field('repeater', { translatable: true, fields: { heading: field('text') } }),
    },
  },
});
useCollections().register('LTNotes', {
  name: 'LTNotes',
  collection: {
    fields: {
      name: field('text'),
      sections: field('repeater', { translatable: true, fields: { heading: field('text') } }),
    },
  },
});

const dialect = new SQLiteDialect();
const db = await dialect.connect(':memory:');

let queries = 0;
const counting: DatabaseAdapter = {
  exec: (sql) => db.exec(sql),
  run: (sql, params) => db.run(sql, params),
  query: <T>(sql: string, params?: SQLParams) => {
    queries += 1;
    return db.query<T>(sql, params);
  },
  queryOne: (sql, params) => db.queryOne(sql, params),
  transaction: (fn) => db.transaction(fn),
  close: () => db.close(),
};

registerDialect(dialect);
registerDatabase(counting);
await syncDatabase(db, dialect, {
  desired: buildDesiredSchema(useCollections(), useFields() as never),
});

const entry = (collection: string): FieldQueryMeta =>
  queryMetadata(collection).fields._translations as FieldQueryMeta;

async function create(collection: string, input: Record<string, unknown>): Promise<string> {
  return (await queryUntyped(collection).createOrThrow(input)).UUID as string;
}

describe('loadTranslations', () => {
  it('lists the held locales per parent in the configured order, spanning every table', async () => {
    const a = await create('LTPosts', { title: 'A' });
    await queryUntyped('LTPosts').locale('fr').where({ UUID: a }).updateOrThrow({ title: 'A-fr' });
    await queryUntyped('LTPosts')
      .locale('de')
      .where({ UUID: a })
      .updateOrThrow({ title: 'A-de', sections: [{ heading: 'de' }] });
    const b = await create('LTPosts', { title: 'B' });
    deepStrictEqual(await loadTranslations(entry('LTPosts'), [a, b], dialect), {
      [a]: ['en', 'de', 'fr'],
      [b]: ['en'],
    });
  });

  it('lists locales held only by locale-scoped derived rows', async () => {
    const note = await create('LTNotes', { name: 'n', sections: [{ heading: 'S' }] });
    await queryUntyped('LTNotes')
      .locale('de')
      .where({ UUID: note })
      .updateOrThrow({ sections: [{ heading: 'DE' }] });
    deepStrictEqual(await loadTranslations(entry('LTNotes'), [note], dialect), {
      [note]: ['en', 'de'],
    });
  });

  it('omits a parent holding nothing and a parent it was not asked about', async () => {
    const bare = await create('LTNotes', { name: 'bare' });
    const other = await create('LTNotes', { name: 'other', sections: [{ heading: 'S' }] });
    deepStrictEqual(await loadTranslations(entry('LTNotes'), [bare], dialect), {});
    deepStrictEqual(Object.keys(await loadTranslations(entry('LTNotes'), [bare, other], dialect)), [
      other,
    ]);
  });

  it('never surfaces a row at an unconfigured locale', async () => {
    const post = await create('LTPosts', { title: 'X' });
    await db.run(
      'INSERT INTO "LTPosts__translations" ("_parentUUID","_localeCode","title") VALUES (?,?,?)',
      [post, 'xx', 'Legacy'],
    );
    deepStrictEqual(await loadTranslations(entry('LTPosts'), [post], dialect), { [post]: ['en'] });
  });

  it('reads each table once per chunk of 900 parents', async () => {
    const uuids = Array.from(
      { length: 905 },
      (_, n) => `00000000-0000-7000-8000-${n.toString().padStart(12, '0')}`,
    );
    for (const uuid of uuids) {
      await db.run('INSERT INTO "LTPosts" ("UUID","_updatedAt") VALUES (?,?)', [uuid, 0]);
      await db.run(
        'INSERT INTO "LTPosts__translations" ("_parentUUID","_localeCode","title") VALUES (?,?,?)',
        [uuid, 'de', 't'],
      );
    }
    queries = 0;
    const held = await loadTranslations(entry('LTPosts'), uuids, dialect);
    strictEqual(queries, 4);
    strictEqual(Object.keys(held).length, 905);
    deepStrictEqual(held[uuids[904] as string], ['de']);
  });
});

describe('hydrating `_translations`', () => {
  it('assembles it by default and under a select naming it', async () => {
    const post = await create('LTPosts', { title: 'H' });
    const whole = await queryUntyped('LTPosts').where({ UUID: post }).findFirst();
    deepStrictEqual(whole?._translations, ['en']);
    const picked = await queryUntyped('LTPosts')
      .where({ UUID: post })
      .select('_translations')
      .findFirst();
    deepStrictEqual(picked, { _translations: ['en'] });
  });

  it('costs no query when a select leaves it out', async () => {
    const post = await create('LTPosts', { title: 'Q' });
    queries = 0;
    await queryUntyped('LTPosts').where({ UUID: post }).select('title').findFirst();
    strictEqual(queries, 1);
  });
});

describe('narrowTranslations', () => {
  const condition = (where: Record<string, unknown>): ConditionNode => {
    const parsed = parseCondition(where);
    ok(parsed.ok);
    return parsed.node;
  };

  it('probes each held locale once, over the records holding it', async () => {
    const a = await create('LTPosts', { title: 'N' });
    await queryUntyped('LTPosts').locale('de').where({ UUID: a }).updateOrThrow({ title: 'M' });
    const b = await create('LTPosts', { title: 'M' });
    const records = [{ _translations: ['en', 'de'] }, { _translations: ['en'] }];
    queries = 0;
    await narrowTranslations(queryMetadata('LTPosts'), records, [a, b], condition({ title: 'N' }));
    strictEqual(queries, 2);
    deepStrictEqual(records, [{ _translations: ['en'] }, { _translations: [] }]);
  });

  it('probes nothing under a condition over plain columns', async () => {
    const records = [{ _translations: ['en'] }];
    queries = 0;
    await narrowTranslations(queryMetadata('LTNotes'), records, ['x'], condition({ name: 'n' }));
    strictEqual(queries, 0);
    deepStrictEqual(records, [{ _translations: ['en'] }]);
  });

  it('probes nothing for records that leave `_translations` out', async () => {
    queries = 0;
    await narrowTranslations(
      queryMetadata('LTPosts'),
      [{ title: 'N' }],
      ['x'],
      condition({ title: 'N' }),
    );
    strictEqual(queries, 0);
  });
});
