import { deepStrictEqual, match, ok, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type {
  DatabaseAdapter,
  SQLParams,
  Transaction,
} from '../../../../src/ohne/database/adapter.ts';

import { useBlocks } from '../../../../src/ohne/blocks/use-blocks.ts';
import { useCollections } from '../../../../src/ohne/collections/use-collections.ts';
import { SQLiteDialect } from '../../../../src/ohne/database/dialects/sqlite/dialect.ts';
import { buildDesiredSchema } from '../../../../src/ohne/database/schema/desired.ts';
import { syncDatabase } from '../../../../src/ohne/database/schema/sync.ts';
import { registerDatabase, registerDialect } from '../../../../src/ohne/database/use-database.ts';
import { field } from '../../../../src/ohne/fields/field.ts';
import { useFields } from '../../../../src/ohne/fields/use-fields.ts';
import { useLayers } from '../../../../src/ohne/layers/use-layers.ts';
import { runCreate } from '../../../../src/ohne/query/write/create.ts';
import { runDelete, runDeleteTranslation } from '../../../../src/ohne/query/write/delete.ts';
import { runUpdate } from '../../../../src/ohne/query/write/update.ts';

useLayers().add({
  path: '/blocks-delete',
  input: { collections: { locales: ['en', 'de'], defaultLocale: 'en' } },
});

useBlocks().register('BDHero', { name: 'BDHero', block: { fields: { title: field('text') } } });
useBlocks().register('BDPanel', {
  name: 'BDPanel',
  block: {
    fields: {
      heading: field('text'),
      rows: field('repeater', {
        fields: { label: field('text'), inner: field('blocks', { allow: ['BDHero'] }) },
      }),
    },
  },
});
useBlocks().register('BDChain', {
  name: 'BDChain',
  block: { fields: { note: field('text'), next: field('blocks', { allow: ['BDChain'] }) } },
});

useCollections().register('BDPosts', {
  name: 'BDPosts',
  collection: {
    fields: {
      title: field('text'),
      content: field('blocks', { allow: ['BDHero', 'BDPanel', 'BDChain'] }),
    },
  },
});
useCollections().register('BDArticles', {
  name: 'BDArticles',
  collection: { fields: { body: field('blocks', { translatable: true, allow: ['BDHero'] }) } },
});
useCollections().register('BDPlain', {
  name: 'BDPlain',
  collection: {
    fields: {
      name: field('text'),
      sections: field('repeater', { fields: { heading: field('text') } }),
    },
  },
});
useCollections().register('BDLocDecks', {
  name: 'BDLocDecks',
  collection: {
    fields: {
      name: field('text'),
      parts: field('repeater', {
        translatable: true,
        fields: { label: field('text'), widgets: field('blocks', { allow: ['BDHero'] }) },
      }),
    },
  },
});

const dialect = new SQLiteDialect();
const db = await dialect.connect(':memory:');

const statements: string[] = [];

/**
 * Wraps a transaction so every statement it issues lands in `statements`.
 */
function record(tx: Transaction): Transaction {
  return {
    exec: (sql) => tx.exec(sql),
    run: (sql, params) => {
      statements.push(sql);
      return tx.run(sql, params);
    },
    query: <T>(sql: string, params?: SQLParams) => {
      statements.push(sql);
      return tx.query<T>(sql, params);
    },
    queryOne: (sql, params) => tx.queryOne(sql, params),
  };
}

const counting: DatabaseAdapter = {
  exec: (sql) => db.exec(sql),
  run: (sql, params) => db.run(sql, params),
  query: <T>(sql: string, params?: SQLParams) => db.query<T>(sql, params),
  queryOne: (sql, params) => db.queryOne(sql, params),
  transaction: (fn, mode) => db.transaction((tx) => fn(record(tx)), mode),
  close: () => db.close(),
};

registerDialect(dialect);
registerDatabase(counting);
await syncDatabase(db, dialect, {
  desired: buildDesiredSchema(useCollections(), useFields() as never, useBlocks()),
});

interface Envelope {
  block: string;
  UUID: string;
  fields: Record<string, unknown>;
}

/**
 * Counts the rows in `table` whose `column` equals `value`.
 */
async function countWhere(table: string, column: string, value: string): Promise<number> {
  const rows = await db.query(`SELECT 1 FROM "${table}" WHERE "${column}" = ?`, [value]);
  return rows.length;
}

/**
 * The condition matching one record by `UUID`.
 */
function uuidIs(uuid: string) {
  return { kind: 'compare', path: ['UUID'], op: 'equalsTo', value: uuid, negated: false } as const;
}

describe('runDelete with blocks', () => {
  it('cleans a nested tower of instances across matched records', async () => {
    const first = await runCreate(
      'BDPosts',
      {
        title: 'TOWER',
        content: [
          {
            block: 'BDPanel',
            fields: {
              heading: 'P',
              rows: [{ label: 'L', inner: [{ block: 'BDHero', fields: { title: 'Deep' } }] }],
            },
          },
          { block: 'BDHero', fields: { title: 'Top' } },
        ],
      },
      null,
    );
    ok(first.ok);
    const second = await runCreate(
      'BDPosts',
      { title: 'TOWER', content: [{ block: 'BDHero', fields: { title: 'Second' } }] },
      null,
    );
    ok(second.ok);
    const [panel, top] = first.record.content as Envelope[];
    const inner = (panel.fields.rows as { inner: Envelope[] }[])[0].inner[0];
    const [other] = second.record.content as Envelope[];

    const result = await runDelete('BDPosts', {
      kind: 'compare',
      path: ['title'],
      op: 'equalsTo',
      value: 'TOWER',
      negated: false,
    });
    deepStrictEqual(result, { deleted: 2 });
    strictEqual(await countWhere('block_BDPanel', 'UUID', panel.UUID), 0);
    strictEqual(await countWhere('block_BDPanel_rows', '_parentUUID', panel.UUID), 0);
    strictEqual(await countWhere('block_BDHero', 'UUID', inner.UUID), 0);
    strictEqual(await countWhere('block_BDHero', 'UUID', top.UUID), 0);
    strictEqual(await countWhere('block_BDHero', 'UUID', other.UUID), 0);
    strictEqual(await countWhere('BDPosts_content', '_parentUUID', first.record.UUID as string), 0);
  });

  it('follows a self-nested chain to the fixed point', async () => {
    const created = await runCreate(
      'BDPosts',
      {
        title: 'CHAIN',
        content: [
          {
            block: 'BDChain',
            fields: {
              note: 'a',
              next: [
                {
                  block: 'BDChain',
                  fields: {
                    note: 'b',
                    next: [{ block: 'BDChain', fields: { note: 'c', next: [] } }],
                  },
                },
              ],
            },
          },
        ],
      },
      null,
    );
    ok(created.ok);
    const [a] = created.record.content as Envelope[];
    const [b] = a.fields.next as Envelope[];
    const [c] = b.fields.next as Envelope[];

    const result = await runDelete('BDPosts', uuidIs(created.record.UUID as string));
    deepStrictEqual(result, { deleted: 1 });
    for (const link of [a, b, c]) {
      strictEqual(await countWhere('block_BDChain', 'UUID', link.UUID), 0);
      strictEqual(await countWhere('block_BDChain_next', '_blockUUID', link.UUID), 0);
    }
  });

  it('issues exactly one statement for a blocks-free collection', async () => {
    const created = await runCreate(
      'BDPlain',
      { name: 'plain', sections: [{ heading: 'h' }] },
      null,
    );
    ok(created.ok);
    statements.length = 0;
    const result = await runDelete('BDPlain', uuidIs(created.record.UUID as string));
    deepStrictEqual(result, { deleted: 1 });
    strictEqual(statements.length, 1);
    match(statements[0], /^DELETE FROM "BDPlain"/);
  });
});

describe('runDeleteTranslation with blocks', () => {
  it('removes only the locale wrapper rows and instances, bumping the record', async () => {
    const created = await runCreate(
      'BDArticles',
      { body: [{ block: 'BDHero', fields: { title: 'EN' } }] },
      null,
    );
    ok(created.ok);
    const uuid = created.record.UUID as string;
    const enHero = (created.record.body as Envelope[])[0];
    const translated = await runUpdate(
      'BDArticles',
      { body: [{ block: 'BDHero', fields: { title: 'DE' } }] },
      uuidIs(uuid),
      'de',
    );
    ok(translated.ok);
    const deHero = (translated.records[0].body as Envelope[])[0];
    await db.run('UPDATE "BDArticles" SET "_updatedAt" = 0 WHERE "UUID" = ?', [uuid]);

    const result = await runDeleteTranslation('BDArticles', uuidIs(uuid), 'de');
    deepStrictEqual(result, { deleted: 1 });
    const locales = await db.query<{ locale: string }>(
      'SELECT "_localeCode" AS "locale" FROM "BDArticles_body" WHERE "_parentUUID" = ?',
      [uuid],
    );
    deepStrictEqual(
      locales.map((row) => row.locale),
      ['en'],
    );
    strictEqual(await countWhere('block_BDHero', 'UUID', deHero.UUID), 0);
    strictEqual(await countWhere('block_BDHero', 'UUID', enHero.UUID), 1);
    strictEqual(await countWhere('BDArticles', 'UUID', uuid), 1);
    const bumped = await db.queryOne<{ at: number }>(
      'SELECT "_updatedAt" AS "at" FROM "BDArticles" WHERE "UUID" = ?',
      [uuid],
    );
    ok((bumped?.at ?? 0) > 0);
  });
});

describe('runDeleteTranslation sweeps instances under locale-scoped composites', () => {
  it("deletes the locale rows' nested instances, leaving the other locale intact", async () => {
    const created = await runCreate(
      'BDLocDecks',
      {
        name: 'L1',
        parts: [{ label: 'en', widgets: [{ block: 'BDHero', fields: { title: 'EN' } }] }],
      },
      null,
    );
    ok(created.ok);
    const uuid = created.record.UUID as string;
    const enParts = created.record.parts as { widgets: Envelope[] }[];
    const enInstance = enParts[0].widgets[0].UUID;

    const translated = await runUpdate(
      'BDLocDecks',
      { parts: [{ label: 'de', widgets: [{ block: 'BDHero', fields: { title: 'DE' } }] }] },
      uuidIs(uuid),
      'de',
    );
    ok(translated.ok);
    const deParts = translated.records[0].parts as { widgets: Envelope[] }[];
    const deInstance = deParts[0].widgets[0].UUID;

    const outcome = await runDeleteTranslation('BDLocDecks', uuidIs(uuid), 'de');
    strictEqual(outcome.deleted, 1);
    strictEqual(await countWhere('block_BDHero', 'UUID', deInstance), 0);
    strictEqual(await countWhere('block_BDHero', 'UUID', enInstance), 1);
    strictEqual(await countWhere('BDLocDecks', 'UUID', uuid), 1);
  });
});
